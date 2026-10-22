"""Lo que Tareas y Agenda cuenta y avisa, por su bandeja de salida (proyecto Minka; fase 10.2b, 2026-10-20).

    emitir(sesion, "tarea.asignada", "tarea:12", {...}, clave=…, usuario_id=…)   # un hecho para las reglas de Qillqa
    avisar(sesion, usuario_id, "Nueva tarea para usted: …", "tarea", evitar=…, destino="tarea:12")   # la campana

Ninguna hace commit ni sale de la transacción de quien llama: se anotan en `minka_bandeja` (modelos_tareas.BANDEJA) y
el repartidor del anfitrión los entrega al bus. Así Minka no importa ni las reglas ni las notificaciones de Qillqa, el
aviso se guarda con el cambio o no se guarda, y nada se pierde si la API se reinicia en medio.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from tiqsi.modulo import opcional

from minka.modelos import BANDEJA, SalidaMinka

ORIGEN = "tareas"


def emitir(sesion, nombre: str, entidad: str, datos: dict | None = None, clave: str | None = None,
           usuario_id: int | None = None) -> None:
    sesion.add(SalidaMinka(tipo=nombre, origen=ORIGEN, intentos=0, error="", datos={
        "entidad": entidad or "", "datos": dict(datos or {}), "clave": clave, "usuario_id": usuario_id}))


def avisar(sesion, usuario_id: int | None, texto: str, tipo: str = "", evitar: int | None = None, destino: str = "") -> None:
    """Un aviso en la campana de `usuario_id`; nadie se avisa a sí mismo (`evitar`)."""
    if not usuario_id or usuario_id == evitar:
        return
    sesion.add(SalidaMinka(tipo="aviso.nuevo", origen=ORIGEN, intentos=0, error="", datos={
        "usuario_id": usuario_id, "texto": texto[:500], "tipo": tipo, "destino": destino[:80]}))


async def ya_emitido(sesion, nombre: str, clave: str) -> bool:
    """¿Minka ya contó este hecho (misma clave)? Lo usa la programación del día para no repetirse."""
    return (await sesion.execute(select(BANDEJA.c.id).where(
        BANDEJA.c.tipo == nombre, BANDEJA.c.datos["clave"].as_string() == clave).limit(1))).first() is not None


async def avisados(sesion, tipo: str, horas: int) -> set[str]:
    """Los destinos («tarea:12») avisados con `tipo` en las últimas `horas`: los de su bandeja y, si está, los que ya
    están en la campana de Qillqa («avisos.v1»; los de antes de la bandeja)."""
    desde = datetime.now(timezone.utc) - timedelta(hours=horas)
    filas = (await sesion.execute(select(BANDEJA.c.datos).where(
        BANDEJA.c.tipo == "aviso.nuevo", BANDEJA.c.datos["tipo"].as_string() == tipo, BANDEJA.c.creado_en >= desde))).scalars()
    propios = {str((d or {}).get("destino") or "") for d in filas} - {""}
    campana = opcional("avisos.v1")
    return propios | (await campana.destinos_recientes(tipo, horas) if campana is not None else set())
