"""Tareas que se crean y se cierran SOLAS (Edison 2026-10-08: «el tablero de tareas y la agenda
deben autocompletarse automáticamente, no esperar a ser llenados a mano… similar a Super
Productivity»).

El trabajo de la entidad ya está en el sistema; aquí se vuelve tarea con dueño y plazo:

- un documento RECIBIDO que pide algo (responder, agendar, emitir opinión, interceder) con
  responsable → «Responder: <asunto>», con el plazo de la entrada; se cierra sola cuando la
  entrada queda respondida o archivada;
- un documento propio ENCARGADO a alguien (responsable) mientras está en borrador, observado
  o en revisión → «Redactar / Corregir / Revisar …»; se cierra sola cuando el documento avanza;
- el SIGUIENTE PASO del trámite de cada oficio numerado en los últimos 30 días (firmar, enviar,
  subir el cargo de recepción, registrar en el STD) para su responsable o quien lo creó; al
  cumplirse el paso, la tarea se cierra y aparece la del paso siguiente.

Cada una lleva `origen='automatica'` y `externo_id` (`entrada:<id>`, `doc:<id>`): sincronizar
dos veces no duplica, y la persona puede cambiar título, plazo o importancia sin que se pisen
(solo se actualizan responsable y cierre, que mandan desde el documento). Las tareas entran solas
en el tablero (por estado), en la matriz (por plazo e importancia) y en el calendario (por plazo).
"""
from __future__ import annotations

import logging
import time as reloj
from datetime import datetime, time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from tiqsi.modulo import opcional

from minka.modelos import Tarea
from minka import tareas_reglas as reglas
from minka.tareas import poner_vinculos, zona

log = logging.getLogger(__name__)
ORIGEN = "automatica"
VERBO_DOC = {"BORRADOR": "Redactar", "OBSERVADO": "Corregir", "EN_REVISION": "Revisar"}
# Paso del trámite → (verbo, importante). Registrar en el STD es necesario pero no apremia.
PASO_TRAMITE = {
    "firmar": ("Firmar y subir el firmado de", True),
    "enviado": ("Enviar por mesa de partes", True),
    "constancia": ("Subir el cargo de recepción de", True),
    "std": ("Registrar en el STD", False),
}
DIAS_TRAMITE = 30

_ULTIMA = 0.0
PAUSA_S = 30


def _plazo(fecha: str) -> datetime | None:
    try:
        d = datetime.strptime((fecha or "")[:10], "%Y-%m-%d").date()
    except ValueError:
        return None
    # Una fecha sin hora vence al terminar el día (como las tareas escritas a mano).
    return datetime.combine(d, time(23, 59), zona())


def _cerrar(t: Tarea) -> None:
    if t.estado in reglas.ABIERTOS:
        t.estado = "hecha"
        t.cerrada_en = reglas.ahora_utc()
        t.version += 1


async def sincronizar(sesion: AsyncSession, forzar: bool = False) -> int:
    """Crea, actualiza y cierra las tareas automáticas. Hace commit si cambió algo. Devuelve
    cuántas tareas tocó. Sin `forzar`, no corre más de una vez cada 30 s."""
    global _ULTIMA
    if not forzar and reloj.monotonic() - _ULTIMA < PAUSA_S:
        return 0
    _ULTIMA = reloj.monotonic()
    existentes = {
        t.externo_id: t
        for t in (await sesion.execute(select(Tarea).where(Tarea.origen == ORIGEN))).scalars().all()
    }
    tocadas = 0

    # Lo que se lee de Mesa de Partes y de Gestión documental, por el contrato (fichas; fase 10.2b). Sin alguno de los
    # dos, esa parte no se sincroniza (ni se cierra nada por no poder preguntar).
    recibidos, documentos = opcional("recibidos.v1"), opcional("documentos.v1")

    # --- Documentos recibidos que piden algo ---------------------------------------------
    entradas = await recibidos.por_atender() if recibidos is not None else []
    for e in entradas:
        clave = f"entrada:{e['id']}"
        t = existentes.get(clave)
        abierta = e["abierta"]
        if t is None:
            if not abierta:
                continue
            etiqueta = e["etiqueta_atencion"]
            asunto = (e["asunto"] or e["documento"] or "documento recibido").strip()
            t = Tarea(
                titulo=f"{etiqueta}: {asunto}"[:1000],
                descripcion=f"De {e['remitente']}{' — ' + e['remitente_cargo'] if e['remitente_cargo'] else ''}".strip(),
                prioridad="alta" if e["atencion"] == "responder" else "normal",
                importante=True,
                responsable_id=e["responsable_id"],
                vence_en=_plazo(e["plazo"]),
                origen=ORIGEN,
                externo_id=clave,
                etiquetas=["recibido"],
            )
            sesion.add(t)
            await sesion.flush()
            await poner_vinculos(sesion, f"tarea:{t.id}", [clave], None)
            tocadas += 1
            continue
        if not abierta and t.estado in reglas.ABIERTOS:
            _cerrar(t)
            tocadas += 1
        elif abierta and t.responsable_id != e["responsable_id"]:
            t.responsable_id = e["responsable_id"]
            t.version += 1
            tocadas += 1

    # --- Documentos propios encargados a alguien ------------------------------------------
    docs = await documentos.encargados() if documentos is not None else []
    vistos = set()
    for d in docs:
        clave = f"doc:{d['id']}"
        vistos.add(clave)
        t = existentes.get(clave)
        verbo = VERBO_DOC.get(d["estado"])
        if t is None:
            if not verbo:
                continue
            asunto = d["asunto"] or "documento"
            t = Tarea(
                titulo=f"{verbo} {d['mostrado']} · {asunto}"[:1000],
                prioridad="normal",
                importante=True,
                responsable_id=d["responsable_id"],
                origen=ORIGEN,
                externo_id=clave,
                etiquetas=["documento"],
            )
            sesion.add(t)
            await sesion.flush()
            await poner_vinculos(sesion, f"tarea:{t.id}", [clave], None)
            tocadas += 1
            continue
        if not verbo:
            if t.estado in reglas.ABIERTOS:
                _cerrar(t)
                tocadas += 1
        else:
            if t.estado not in reglas.ABIERTOS and t.estado != "cancelada":
                # Volvió atrás (p. ej. lo observaron): la tarea se reabre con el verbo nuevo.
                t.estado, t.cerrada_en = "por_hacer", None
                t.titulo = f"{verbo} {d['mostrado']} · {d['asunto'] or 'documento'}"[:1000]
                t.version += 1
                tocadas += 1
            if t.responsable_id != d["responsable_id"]:
                t.responsable_id = d["responsable_id"]
                t.version += 1
                tocadas += 1
    # Un documento que se quedó sin responsable: su tarea ya no tiene dueño que la haga.
    for clave, t in (existentes.items() if documentos is not None else ()):
        if clave.startswith("doc:") and clave.count(":") == 1 and clave not in vistos and t.estado in reglas.ABIERTOS:
            _cerrar(t)
            tocadas += 1

    if documentos is not None:
        tocadas += await _tramites(sesion, existentes, documentos)
        tocadas += await recomponer_titulos(sesion, [t for t in existentes.values() if t.externo_id.startswith("doc:")])

    if tocadas:
        await sesion.commit()
        log.info("Tareas automáticas: %s cambios", tocadas)
    return tocadas



async def _tramites(sesion: AsyncSession, existentes: dict[str, Tarea], documentos) -> int:
    """Una tarea por el paso que le toca a cada oficio reciente; la del paso cumplido se cierra. El paso lo calcula
    Gestión documental («documentos.v1».tramites: firmado, recepciones, ámbito)."""
    docs = await documentos.tramites(DIAS_TRAMITE)
    tocadas = 0
    queridas: set[str] = set()
    for d in docs:
        paso = d["paso"]
        if not paso or paso not in PASO_TRAMITE:
            continue
        clave = f"doc:{d['id']}:{paso}"
        queridas.add(clave)
        if clave in existentes:
            continue
        verbo, importante = PASO_TRAMITE[paso]
        if paso == "enviado" and d["interno"]:
            verbo = "Enviar"
        asunto = d["asunto"]
        t = Tarea(
            titulo=f"{verbo} {d['mostrado']}{' · ' + asunto if asunto else ''}"[:1000],
            importante=importante,
            responsable_id=d["responsable_id"] or d["creado_por"],
            origen=ORIGEN,
            externo_id=clave,
            etiquetas=["trámite"],
        )
        sesion.add(t)
        await sesion.flush()
        await poner_vinculos(sesion, f"tarea:{t.id}", [f"doc:{d['id']}"], None)
        tocadas += 1
    # El paso que ya se cumplió cierra su tarea.
    # (Un documento que salió de la ventana de 30 días conserva su tarea abierta: no se cumplió.)
    en_ventana = {f"doc:{d['id']}" for d in docs}
    for clave, t in existentes.items():
        if (clave.count(":") == 2 and clave not in queridas and clave.rsplit(":", 1)[0] in en_ventana
                and t.estado in reglas.ABIERTOS):
            _cerrar(t)
            tocadas += 1
    return tocadas


# --- Lo vinculado vigente (2026-10-12) ------------------------------------------------------
# El título de una tarea de documento lleva su número y su asunto («Firmar y subir el firmado de
# Oficio S/N-… · asunto»): es una COPIA que se recompone cuando el documento se numera o cambia el
# asunto. Si una persona reescribió el título (ya no empieza por el verbo y la etiqueta de un
# documento), se respeta.

def _verbos() -> list[str]:
    todos = {*VERBO_DOC.values(), *(v for v, _ in PASO_TRAMITE.values()), "Enviar"}
    return sorted(todos, key=len, reverse=True)


def recomponer_titulo_tarea(titulo: str, numero: str, asunto: str) -> str:
    """«<verbo> <etiqueta de documento>[ · <asunto>]» con el número y el asunto VIGENTES; otro
    título queda igual. Pura."""
    import re

    from minka.agenda_detectada import es_etiqueta_documento

    m = re.match(r"^(%s) (.+?)(?: · (.*))?$" % "|".join(re.escape(v) for v in _verbos()), titulo or "", re.S)
    if not m or not es_etiqueta_documento(m.group(2)):
        return titulo
    asunto = (asunto or "").strip()
    return f"{m.group(1)} {numero}{' · ' + asunto if asunto else ''}"[:1000]


async def recomponer_titulos(sesion: AsyncSession, tareas: list[Tarea], fichas: dict[int, dict] | None = None) -> int:
    """Las tareas abiertas de documento con el número y el asunto vigentes. Sin commit; no sube
    `version` (no lo tocó una persona). `fichas`: las de los documentos, si quien llama ya las tiene (lo recién guardado);
    si no, se piden por «documentos.v1». Devuelve cuántas cambió."""
    abiertas = [t for t in tareas if t.estado in reglas.ABIERTOS and t.externo_id.startswith("doc:")]
    ids = {int(t.externo_id.split(":")[1]) for t in abiertas if t.externo_id.split(":")[1].isdigit()}
    if not ids:
        return 0
    if fichas is None:
        documentos = opcional("documentos.v1")
        fichas = await documentos.fichas(ids) if documentos is not None else {}
    docs = fichas
    n = 0
    for t in abiertas:
        parte = t.externo_id.split(":")[1]
        d = docs.get(int(parte)) if parte.isdigit() else None
        if d is None:
            continue
        nuevo = recomponer_titulo_tarea(t.titulo, d["mostrado"], d["asunto"])
        if nuevo != t.titulo:
            t.titulo = nuevo
            n += 1
    return n


async def recomponer_de_documento(sesion: AsyncSession, ficha: dict) -> int:
    """Las tareas automáticas del documento con su número y asunto vigentes (`ficha`: la de lo recién guardado)."""
    doc_id = ficha["id"]
    tareas = (await sesion.execute(select(Tarea).where(
        Tarea.origen == ORIGEN, (Tarea.externo_id == f"doc:{doc_id}") | Tarea.externo_id.like(f"doc:{doc_id}:%")
    ))).scalars().all()
    return await recomponer_titulos(sesion, list(tareas), {doc_id: ficha})

