"""La base de Tareas y Agenda: su motor, su sesión y la preparación de sus tablas (proyecto Minka; fase 10.2b, 2026-10-20).
Con MINKA_DATABASE_URL, su base propia (nace al arrancar si falta); sin ella, la documental.

Separar sus datos de la base documental es una orden del módulo (simula por omisión; tiqsi.sql.separar copia y verifica
cada tabla). Lee el origen de DATABASE_URL y el destino de MINKA_DATABASE_URL:

    python -m minka.db separar             # qué copiaría (filas y huella por tabla)
    python -m minka.db separar --aplicar   # copia, verifica y trae lo suyo que aún vive en Qillqa

Lo suyo que aún viva en tablas de Qillqa (una base de producción que nunca arrancó este código) se trae también: sus
vínculos (de `relaciones`, que se QUITAN de allí en la misma operación: si no, las referencias los verían dos veces) y lo
descartado de la agenda (de `ajustes`, que se deja: nadie más lo lee).
"""
from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from minka.config import url_base

motor = create_async_engine(url_base(), pool_pre_ping=True)
SesionMinka = async_sessionmaker(motor, expire_on_commit=False)

# Migraciones ligeras e idempotentes (antes en main.py): lo que `create_all` no altera en tablas ya existentes. Sin
# claves foráneas hacia Qillqa (la cuenta y la persona se guardan como número).
MIGRACIONES = (
    "ALTER TABLE tareas ADD COLUMN IF NOT EXISTS importante boolean NOT NULL DEFAULT false",
    # Recordatorios de eventos (2026-10-12).
    "ALTER TABLE agenda_eventos ADD COLUMN IF NOT EXISTS recordatorio_minutos integer",
    "ALTER TABLE agenda_eventos ADD COLUMN IF NOT EXISTS recordatorio_avisado_en timestamptz",
    # Por confirmar, autoría y clase de tarea (2026-10-18).
    "ALTER TABLE agenda_eventos ADD COLUMN IF NOT EXISTS actualizado_por integer",
    "ALTER TABLE tareas ADD COLUMN IF NOT EXISTS clase varchar(10) NOT NULL DEFAULT ''",
    # El nombre viejo sale de los datos (2026-10-22, fase 10.4; propuesta §8.9): idempotente, al arrancar; el corte lo aplica
    # sobre los datos de producción y su vuelta atrás es restaurar el respaldo del corte.
    "UPDATE tareas SET origen = 'qillqa' WHERE origen = 'sgdp'",
    "UPDATE agenda_eventos SET origen = 'qillqa' WHERE origen = 'sgdp'",
)


# Sus vínculos, de `relaciones` (tipo «vinculo», origen tarea:/evento:) a `minka_vinculos`, con su id, y fuera de
# `relaciones`: en UNA transacción e idempotente (fase 10.2b, 2026-10-20). Solo si esa tabla está en la misma base.
TRASLADAR_VINCULOS = (
    "INSERT INTO minka_vinculos (id, origen, destino, datos, creado_por, creado_en) "
    "SELECT DISTINCT ON (origen, destino) id, origen, destino, coalesce(datos, '{}'::jsonb), creado_por, creado_en "
    "FROM relaciones WHERE tipo = 'vinculo' AND (origen LIKE 'tarea:%' OR origen LIKE 'evento:%') "
    "ORDER BY origen, destino, id ON CONFLICT DO NOTHING",
    "DELETE FROM relaciones WHERE tipo = 'vinculo' AND (origen LIKE 'tarea:%' OR origen LIKE 'evento:%')",
    "SELECT setval(pg_get_serial_sequence('minka_vinculos', 'id'), "
    "greatest(coalesce((SELECT max(id) FROM minka_vinculos), 0), (SELECT last_value FROM relaciones_id_seq)) + 1, false)",
)


async def obtener_sesion_minka() -> AsyncGenerator[AsyncSession, None]:
    """Dependencia de FastAPI: una sesión de la base de Tareas y Agenda, siempre cerrada."""
    async with SesionMinka() as sesion:
        yield sesion


class SinSeparar(SystemExit):
    """Su base propia está vacía y la documental aún tiene las tareas y la agenda: arrancar así empezaría un módulo vacío."""


async def _sin_separar() -> bool:
    """¿Su base es otra, está vacía y la documental aún tiene las tareas y la agenda? Solo si DATABASE_URL está definida (sola, no)."""
    import os

    from tiqsi.sql import sin_separar

    from minka.config import config

    if not config.minka_database_url or "DATABASE_URL" not in os.environ:
        return False
    return await sin_separar(config.minka_database_url, config.database_url, ('tareas', 'agenda_eventos'))


async def preparar() -> None:
    """Su base (si falta), sus tablas y sus migraciones (idempotente). Se NIEGA a arrancar sobre su
    base propia vacía si la documental aún tiene sus datos (separe primero; tiqsi.sql.sin_separar)."""
    from tiqsi.sql import crear_base_si_falta

    from minka.modelos import BaseMinka

    await crear_base_si_falta(motor.url)
    if await _sin_separar():
        raise SinSeparar("La base propia está vacía y la documental aún tiene las tareas y la agenda: sepárela primero "
                         "(python -m minka.db separar --aplicar).")
    async with motor.begin() as conexion:
        await conexion.run_sync(BaseMinka.metadata.create_all)
        for sql in MIGRACIONES:
            await conexion.execute(text(sql))
        if (await conexion.execute(text("SELECT to_regclass('ajustes')"))).scalar():
            # Lo descartado de la agenda detectada, de los ajustes de la plataforma a los suyos (una vez).
            await conexion.execute(text(
                "INSERT INTO minka_ajustes (clave, valor) SELECT clave, valor FROM ajustes "
                "WHERE despacho_id = 1 AND clave = 'agenda_descartados' ON CONFLICT (clave) DO NOTHING"))
        if (await conexion.execute(text("SELECT to_regclass('relaciones')"))).scalar():
            quedan = (await conexion.execute(text(
                "SELECT count(*) FROM relaciones WHERE tipo = 'vinculo' AND (origen LIKE 'tarea:%' OR origen LIKE 'evento:%')"
            ))).scalar()
            if quedan:
                for sql in TRASLADAR_VINCULOS:
                    await conexion.execute(text(sql))


async def separar(aplicar: bool = False) -> dict:
    """Sus tablas, de la base documental (DATABASE_URL) a la suya (MINKA_DATABASE_URL)."""
    import json

    from sqlalchemy.ext.asyncio import create_async_engine
    from tiqsi.sql import crear_base_si_falta, separar as separar_tablas

    from minka.modelos import BaseMinka
    from minka.config import config

    if not config.minka_database_url:
        raise SystemExit("Falta MINKA_DATABASE_URL (la base propia de Tareas y Agenda).")
    if aplicar:
        await crear_base_si_falta(motor.url)
    plan = await separar_tablas(config.database_url, config.minka_database_url, BaseMinka.metadata, aplicar=aplicar)
    origen = create_async_engine(config.database_url)
    try:
        async with origen.connect() as o:
            hay = lambda tabla: o.execute(text(f"SELECT to_regclass('{tabla}')"))  # noqa: E731
            vinculos = ((await o.execute(text(
                "SELECT id, origen, destino, coalesce(datos, '{}'::jsonb), creado_por, creado_en FROM relaciones "
                "WHERE tipo = 'vinculo' AND (origen LIKE 'tarea:%' OR origen LIKE 'evento:%') ORDER BY id"))).all()
                if (await hay("relaciones")).scalar() else [])
            descartados = ((await o.execute(text(
                "SELECT valor FROM ajustes WHERE despacho_id = 1 AND clave = 'agenda_descartados'"))).scalar()
                if (await hay("ajustes")).scalar() else None)
        plan["(relaciones → minka_vinculos)"] = {"filas": len(vinculos), "huella": "-"}
        if not aplicar:
            return plan
        async with motor.begin() as d:
            for v in vinculos:
                await d.execute(text(
                    "INSERT INTO minka_vinculos (id, origen, destino, datos, creado_por, creado_en) "
                    "VALUES (:i, :o, :d, CAST(:x AS jsonb), :c, :f) ON CONFLICT DO NOTHING"),
                    {"i": v[0], "o": v[1], "d": v[2], "x": json.dumps(v[3]), "c": v[4], "f": v[5]})
            if vinculos:
                await d.execute(text("SELECT setval(pg_get_serial_sequence('minka_vinculos', 'id'), "
                                     "coalesce((SELECT max(id) FROM minka_vinculos), 0) + 1, false)"))
            if descartados is not None:
                await d.execute(text("INSERT INTO minka_ajustes (clave, valor) VALUES ('agenda_descartados', CAST(:v AS jsonb)) "
                                     "ON CONFLICT (clave) DO NOTHING"), {"v": json.dumps(descartados)})
            copiados = (await d.execute(text("SELECT count(*) FROM minka_vinculos WHERE id = ANY(:ids)"),
                                        {"ids": [v[0] for v in vinculos]})).scalar() if vinculos else 0
        if copiados != len(vinculos):
            raise SystemExit(f"Solo {copiados} de {len(vinculos)} vínculos llegaron: no se quitan de relaciones.")
        if vinculos:
            async with origen.begin() as o:
                await o.execute(text("DELETE FROM relaciones WHERE tipo = 'vinculo' AND (origen LIKE 'tarea:%' OR origen LIKE 'evento:%')"))
    finally:
        await origen.dispose()
    return plan


def _principal(argv: list[str]) -> int:
    import argparse
    import asyncio

    from tiqsi.sql import ErrorDeSeparacion

    p = argparse.ArgumentParser(prog="python -m minka.db", description="La base propia de Tareas y Agenda.")
    sub = p.add_subparsers(dest="orden", required=True)
    s = sub.add_parser("separar", help="sus tablas a su base (simula sin --aplicar)")
    s.add_argument("--aplicar", action="store_true")
    a = p.parse_args(argv)
    try:
        plan = asyncio.run(separar(a.aplicar))
    except ErrorDeSeparacion as e:
        print(f"[error] {e}")
        return 1
    for tabla, d in plan.items():
        print(f"  {tabla:<30} {d['filas']:>6} filas  {d['huella'][:12]}")
    print("Copiado y verificado." if a.aplicar else "Simulación: nada se copió (--aplicar para hacerlo).")
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(_principal(sys.argv[1:]))
