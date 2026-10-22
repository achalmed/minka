"""minka/programacion.py — la PROGRAMACIÓN DEL DÍA en el chat (2026-10-13; el tema
«Programación diaria de actividades» que el despacho llevaba en Telegram).

Cada mañana, desde las 7:00 (hora de la entidad, `HORA`), emite el evento
`agenda.programacion_diaria` con las actividades de hoy de la Agenda (las series repetidas ya
desplegadas, sin las suspendidas ni las canceladas, ni lo por confirmar). La regla de fábrica `canal-programacion` lo
publica en el tema «Programación del día» como una tarjeta: la fecha y una línea por actividad.
Se apaga en Administración → Reglas. Idempotente por la clave del evento
(`agenda:AAAA-MM-DD:programacion_diaria`): reiniciar la API no lo repite. Un día sin actividades
no publica nada (no hace ruido).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, time, timedelta

log = logging.getLogger("qillqa.programacion")

HORA = 7          # desde qué hora local se publica
INTERVALO = 600   # cada cuánto se mira (s)
MAX_LINEAS = 15


def _cuenta(o: dict) -> bool:
    """Lo confirmado del día: sin lo suspendido, lo cancelado ni las solicitudes por confirmar o
    descartadas (2026-10-18; `_eventos_en` ya no las trae, esto es la segunda llave)."""
    from minka.agenda_reglas import anunciable

    return anunciable(o.get("estado"))


def linea(o: dict) -> str:
    """«08:30 Sesión del Pleno · Hemiciclo» o «Todo el día · Semana de representación»."""
    if o.get("todo_el_dia"):
        hora = "Todo el día"
    else:
        try:
            hora = datetime.fromisoformat(str(o.get("inicio"))).strftime("%H:%M")
        except ValueError:
            hora = ""
    partes = [f"{hora} {o.get('titulo') or ''}".strip()]
    if o.get("lugar"):
        partes.append(str(o["lugar"]))
    return " · ".join(partes)


def actividades(ocurrencias: list[dict]) -> list[dict]:
    """Las de hoy como {hora, titulo, lugar}, en el mismo orden y con el mismo tope que `resumen`
    (para el mensaje del chat, `redaccion_chat.programacion`)."""
    vivas = [o for o in ocurrencias if _cuenta(o)]
    vivas.sort(key=lambda o: (not o.get("todo_el_dia"), str(o.get("inicio") or "")))
    salida = []
    for o in vivas[:MAX_LINEAS]:
        hora = "Todo el día"
        if not o.get("todo_el_dia"):
            try:
                hora = datetime.fromisoformat(str(o.get("inicio"))).strftime("%H:%M")
            except ValueError:
                hora = ""
        salida.append({"hora": hora, "titulo": str(o.get("titulo") or ""), "lugar": str(o.get("lugar") or "")})
    return salida


def resumen(ocurrencias: list[dict]) -> tuple[int, str]:
    """(cuántas, el texto de una línea por actividad, primero las de todo el día). Las suspendidas y
    canceladas no cuentan."""
    vivas = [o for o in ocurrencias if _cuenta(o)]
    vivas.sort(key=lambda o: (not o.get("todo_el_dia"), str(o.get("inicio") or "")))
    lineas = [linea(o) for o in vivas[:MAX_LINEAS]]
    if len(vivas) > MAX_LINEAS:
        lineas.append(f"y {len(vivas) - MAX_LINEAS} más en la Agenda")
    return len(vivas), "\n".join(lineas)


async def publicar_hoy(sesion, hoy: date | None = None) -> bool:
    """Emite la programación de `hoy` si hay actividades y no se emitió ya. → si emitió."""
    from minka.api_agenda import _eventos_en, _expandir
    from minka import eventos as salida
    from minka import tareas as svc_tareas

    tz = svc_tareas.zona()
    hoy = hoy or datetime.now(tz).date()
    clave = f"agenda:{hoy.isoformat()}:programacion_diaria"
    # Ya contada hoy (por su bandeja). La de un día publicado antes de la bandeja la descarta Qillqa por su clave.
    if await salida.ya_emitido(sesion, "agenda.programacion_diaria", clave):
        return False
    ini = datetime.combine(hoy, time(0), tz)
    fin = ini + timedelta(days=1)
    ocs, _ = await _expandir(sesion, await _eventos_en(sesion, ini, fin), ini, fin)
    n, texto = resumen(ocs)
    if not n:
        return False
    salida.emitir(sesion, "agenda.programacion_diaria", "", {"fecha": hoy.isoformat(), "n": n, "resumen": texto,
                                                            "actividades": actividades(ocs),
                                                            "ruta": f"/agenda?vista=dia&fecha={hoy.isoformat()}"}, clave=clave)
    await sesion.commit()
    return True


async def bucle() -> None:
    """Lo lanza main.py. Un fallo se anota y se reintenta en la vuelta siguiente."""
    from minka import tareas as svc_tareas
    from minka.db import SesionMinka

    await asyncio.sleep(45)
    while True:
        try:
            if datetime.now(svc_tareas.zona()).hour >= HORA:
                async with SesionMinka() as sesion:
                    if await publicar_hoy(sesion):
                        log.info("Programación del día publicada en el chat.")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("Programación del día: %s", e)
        await asyncio.sleep(INTERVALO)
