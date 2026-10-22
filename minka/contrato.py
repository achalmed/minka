"""Lo que Tareas y Agenda ofrece a los demás módulos (proyecto Minka; fase 10.2b, 2026-10-20). Cada operación abre SU
sesión (nunca la de quien llama): quien la usa no ve sus tablas ni comparte su transacción.

«vinculos.v1»: los vínculos de sus tareas y eventos que tocan un nodo (`de_nodo("doc:12")`), con la forma de una fila de
relaciones, para quien lista las relaciones de algo (Qillqa, servicios/relaciones.de_origen).
«tareas.v1»: una tarea (`tarea`) y crear una sin pasar por la pantalla (`crear`: la regla «tarea», el seguimiento),
idempotente por su clave externa.
«agenda.v1»: un evento con sus participantes (`evento`), el evento parecido (`parecido`, `reunion_parecida`), lo que un
documento anuncia (`sincronizar_documento`, tras guardarlo), las actividades pegadas en el chat (`registrar_actividades`)
y sus catálogos (`tipos`, `modalidades`).
Lo que le pasa a Qillqa (un documento numerado, cambiado de estado o eliminado; un proyecto eliminado; un recibido
registrado) le llega por el bus: `al_documento`, `al_eliminado`, `al_recibido` (servicios/minka_manifiesto.py).
"""
from __future__ import annotations

FUNCIONES = ("de_nodo",)


async def de_nodo(nodo: str) -> list[dict]:
    from sqlalchemy import or_, select

    from minka.modelos import VinculoMinka
    from minka.db import SesionMinka

    async with SesionMinka() as sesion:
        filas = (await sesion.execute(select(VinculoMinka).where(
            or_(VinculoMinka.origen == nodo, VinculoMinka.destino == nodo)).order_by(VinculoMinka.id))).scalars().all()
    return [{"id": v.id, "origen": v.origen, "destino": v.destino, "tipo": "vinculo", "contexto": "", "fuente": "manual",
             "texto": "", "datos": v.datos or {}} for v in filas]


async def tarea(tarea_id: int) -> dict | None:
    """{id, titulo, descripcion, responsable_id, vence_en, con_hora, prioridad, origen, estado, creado_por, eliminado_en}."""
    from minka.modelos import Tarea
    from minka.db import SesionMinka

    async with SesionMinka() as sesion:
        t = await sesion.get(Tarea, int(tarea_id))
    if t is None:
        return None
    return {"id": t.id, "titulo": t.titulo, "descripcion": t.descripcion, "responsable_id": t.responsable_id,
            "vence_en": t.vence_en, "con_hora": bool(t.con_hora), "prioridad": t.prioridad, "origen": t.origen,
            "estado": t.estado, "creado_por": t.creado_por, "eliminado_en": getattr(t, "eliminado_en", None)}


async def crear(titulo: str, *, descripcion: str = "", responsable_id: int | None = None, plazo: str | None = None,
                origen: str, externo_id: str, creado_por: int | None = None, vinculos: list[str] | None = None) -> int:
    """Una tarea creada por otro módulo (una regla, el seguimiento de un documento). `plazo`: AAAA-MM-DD. Idempotente: si ya
    hay una con ese `origen` y `externo_id`, devuelve la suya (una entrega repetida del bus no duplica). Hace commit."""
    from sqlalchemy import select

    from minka.modelos import Tarea
    from minka import tareas as svc
    from minka import tareas_reglas as reglas
    from minka.db import SesionMinka

    async with SesionMinka() as sesion:
        ya = (await sesion.execute(select(Tarea.id).where(Tarea.origen == origen, Tarea.externo_id == externo_id[:300]))).scalar()
        if ya:
            return ya
        vence, con_hora = reglas.plazo(str(plazo)[:10], None, svc.zona()) if plazo else (None, False)
        t = Tarea(titulo=titulo[:300], descripcion=descripcion, estado="por_hacer", prioridad="normal",
                  responsable_id=responsable_id, vence_en=vence, con_hora=con_hora, origen=origen,
                  externo_id=externo_id[:300], creado_por=creado_por, etiquetas=[], checklist=[])
        sesion.add(t)
        await sesion.flush()
        if vinculos:
            await svc.poner_vinculos(sesion, f"tarea:{t.id}", vinculos, creado_por)
        await sesion.commit()
        return t.id


async def evento(evento_id: int) -> dict | None:
    """{id, titulo, tipo, inicio, fin, todo_el_dia, lugar, modalidad, enlace, descripcion, estado, responsable_id,
    creado_por, participantes: [{nombre, usuario_id}]}."""
    from sqlalchemy import select

    from minka.modelos import EventoAgenda, EventoParticipante
    from minka.db import SesionMinka

    async with SesionMinka() as sesion:
        e = await sesion.get(EventoAgenda, int(evento_id))
        if e is None:
            return None
        part = [{"nombre": p.nombre or "", "usuario_id": p.usuario_id} for p in (await sesion.execute(
            select(EventoParticipante).where(EventoParticipante.evento_id == e.id))).scalars()]
    return {"id": e.id, "titulo": e.titulo, "tipo": e.tipo, "inicio": e.inicio, "fin": e.fin, "todo_el_dia": e.todo_el_dia,
            "lugar": e.lugar, "modalidad": e.modalidad, "enlace": e.enlace, "descripcion": e.descripcion, "estado": e.estado,
            "responsable_id": e.responsable_id, "creado_por": e.creado_por, "participantes": part}


async def parecido(titulo: str, inicio: str, todo_el_dia: bool) -> dict | None:
    """El evento ya agendado que es la misma actividad (servicios/tareas.evento_parecido)."""
    from minka import tareas as svc
    from minka.db import SesionMinka

    async with SesionMinka() as sesion:
        return await svc.evento_parecido(sesion, titulo, inicio, todo_el_dia)


async def reunion_parecida(reunion: str) -> dict | None:
    """El evento al que un documento da seguimiento: por su fecha si la trae y, si no, el más parecido por título de los
    últimos y próximos 90 días. {id, titulo, inicio} o None."""
    import re
    from datetime import datetime, timedelta

    from sqlalchemy import select

    from minka.modelos import EventoAgenda
    from minka import tareas as svc
    from minka import tareas_reglas as reglas
    from minka.db import SesionMinka

    m = re.search(r"(\d{4}-\d{2}-\d{2})", reunion)
    titulo = re.sub(r"[(\[]?\d{4}-\d{2}-\d{2}[)\]]?", "", reunion).strip(" ,;-·") or reunion
    async with SesionMinka() as sesion:
        if m:
            return await svc.evento_parecido(sesion, titulo, m.group(1), True)
        ahora = datetime.now(svc.zona())
        filas = (await sesion.execute(select(EventoAgenda).where(
            EventoAgenda.inicio >= ahora - timedelta(days=90), EventoAgenda.inicio <= ahora + timedelta(days=90),
            EventoAgenda.estado != "cancelado"))).scalars().all()
    mejor, puntaje = None, 0.0
    for e in filas:
        p = reglas.parecido(titulo, e.titulo, False)
        if p >= reglas.UMBRAL_PARECIDO and p > puntaje:
            mejor, puntaje = e, p
    return {"id": mejor.id, "titulo": mejor.titulo, "inicio": mejor.inicio.isoformat()} if mejor is not None else None


async def sincronizar_documento(ficha: dict, usuario_id: int | None) -> int:
    """Lo que un documento recién guardado anuncia, en la agenda (agenda_detectada.sincronizar_documento). Hace commit."""
    from types import SimpleNamespace

    from minka import agenda_detectada
    from minka.db import SesionMinka

    async with SesionMinka() as sesion:
        n = await agenda_detectada.sincronizar_documento(sesion, ficha, SimpleNamespace(id=usuario_id) if usuario_id else None)
        await sesion.commit()
        return n


async def registrar_actividades(actividades: list[dict], usuario_id: int) -> dict:
    """Las actividades de un bloque «agenda-actividades» pegado en el chat: las que ya estaban (`existentes`, títulos) no se
    repiten; las nuevas se agendan y se cuentan como las de la Agenda. {creados: [{id, estado}], existentes}. Hace commit."""
    from datetime import datetime
    from types import SimpleNamespace

    from minka.api_agenda import EventoEntrada, _aplicar, _validar
    from minka.modelos import EventoAgenda
    from minka import tareas as svc
    from minka.agenda_reglas import estado_de_pegado
    from minka.db import SesionMinka

    quien = SimpleNamespace(id=usuario_id)
    creados, existentes = [], []
    async with SesionMinka() as sesion:
        for a in actividades or []:
            inicio = a["inicio"] if "T" in a["inicio"] else f"{a['inicio']}T00:00:00"
            todo = bool(a.get("todo_el_dia")) or "T" not in a["inicio"]
            ya = await svc.evento_parecido(sesion, a.get("titulo") or "", inicio, todo)
            if ya:
                existentes.append(ya["titulo"])
                continue
            datos = EventoEntrada(titulo=a["titulo"][:300], descripcion=a.get("descripcion") or "", tipo=a.get("tipo") or "otro",
                                  inicio=datetime.fromisoformat(inicio), estado=estado_de_pegado(a.get("confirmacion")),
                                  fin=datetime.fromisoformat(a["fin"]) if a.get("fin") and "T" in a["fin"] else None, todo_el_dia=todo,
                                  lugar=(a.get("lugar") or "")[:300], modalidad=a.get("modalidad") or "presencial", enlace=a.get("enlace") or "",
                                  recordatorio_minutos=a.get("recordatorio"))
            _validar(datos)
            e = EventoAgenda(creado_por=usuario_id, actualizado_por=usuario_id, excepciones=[], origen="chat")
            _aplicar(e, datos)
            sesion.add(e)
            await sesion.flush()
            creados.append({"id": e.id, "estado": e.estado})
            # Como al agendar desde la Agenda: el tema «Agenda» lo cuenta (solo lo confirmado).
            await svc.anunciar_evento(sesion, e, quien)
        await sesion.commit()
    return {"creados": creados, "existentes": existentes}


def tipos() -> dict:
    from minka.agenda_reglas import TIPOS

    return dict(TIPOS)


def modalidades() -> dict:
    from minka.agenda_reglas import MODALIDADES

    return dict(MODALIDADES)


# --- lo que le pasa a Qillqa, por el bus (después de su commit) -------------------------------------------------------


def _id_de(evento, prefijo: str) -> int | None:
    entidad = str((evento.datos or {}).get("entidad") or "")
    return int(entidad.split(":", 1)[1]) if entidad.startswith(f"{prefijo}:") and entidad.split(":", 1)[1].isdigit() else None


async def al_documento(evento) -> None:
    """«documento.numerado» o «documento.estado»: sus eventos detectados y sus tareas automáticas con la etiqueta vigente."""
    from tiqsi.modulo import opcional

    from minka import agenda_detectada
    from minka import tareas_automaticas
    from minka.db import SesionMinka

    doc_id, docs = _id_de(evento, "doc"), opcional("documentos.v1")
    if doc_id is None or docs is None:
        return
    ficha = (await docs.fichas([doc_id])).get(doc_id)
    if ficha is None:
        return
    async with SesionMinka() as sesion:
        await agenda_detectada.recomponer_de_documento(sesion, ficha)
        await tareas_automaticas.recomponer_de_documento(sesion, ficha)
        await sesion.commit()


async def al_eliminado(evento) -> None:
    """«documento.eliminado» o «proyecto.eliminado»: lo que el documento anunciaba y nadie tocó se va con él, y los vínculos
    que apuntaban a lo eliminado quedan marcados (como en las relaciones de Qillqa: el texto de quien vinculaba sigue)."""
    from datetime import datetime

    from sqlalchemy import select

    from minka.modelos import VinculoMinka
    from minka import agenda_detectada
    from minka.db import SesionMinka

    nodo = str((evento.datos or {}).get("entidad") or "")
    if ":" not in nodo:
        return
    etiqueta = str((evento.datos or {}).get("etiqueta") or "")
    async with SesionMinka() as sesion:
        if nodo.startswith("doc:"):
            await agenda_detectada.al_eliminar_origen(sesion, nodo)
        ahora = datetime.now().astimezone().isoformat(timespec="seconds")
        for v in (await sesion.execute(select(VinculoMinka).where(VinculoMinka.destino == nodo))).scalars().all():
            if not (v.datos or {}).get("destino_eliminado"):
                v.datos = {**(v.datos or {}), "destino_eliminado": {"etiqueta": etiqueta, "fecha": ahora}}
        await sesion.commit()


async def al_recibido(evento) -> None:
    """«entrada.registrada»: lo que el recibido anuncia (reunión, citación…), propuesto en la agenda."""
    from types import SimpleNamespace

    from tiqsi.modulo import opcional

    from minka import agenda_detectada
    from minka.db import SesionMinka

    entrada_id, recibidos = _id_de(evento, "entrada"), opcional("recibidos.v1")
    if entrada_id is None or recibidos is None:
        return
    ficha = await recibidos.ficha(entrada_id)
    if ficha is None:
        return
    quien = (evento.datos or {}).get("emitido_por")
    async with SesionMinka() as sesion:
        await agenda_detectada.proponer_de_entrada(sesion, ficha, SimpleNamespace(id=quien) if quien else None)
        await sesion.commit()


async def resolver_tarea(ident: str) -> dict | None:
    """«tareas:tarea:<id>» → {titulo («Tarea: …»), estado, enlace}."""
    t = await tarea(int(ident)) if ident.isdigit() else None
    return {"titulo": f"Tarea: {t['titulo'][:90]}", "estado": t["estado"], "enlace": f"/tareas?tarea={t['id']}"} if t else None


async def resolver_evento(ident: str) -> dict | None:
    """«tareas:evento:<id>» → {titulo («Evento: …»), estado, enlace}."""
    e = await evento(int(ident)) if ident.isdigit() else None
    return {"titulo": f"Evento: {e['titulo'][:90]}", "estado": e["estado"], "enlace": f"/agenda?evento={e['id']}"} if e else None


class _Superficie:
    """Resuelve cada nombre al usarlo y rechaza lo que no está en la lista (el contrato se cumple)."""

    def __init__(self, nombre: str, funciones: tuple[str, ...]) -> None:
        self._nombre, self._funciones = nombre, funciones

    def __getattr__(self, nombre: str):
        if nombre in self._funciones:
            return globals()[nombre]
        raise AttributeError(f"«{nombre}» no es parte de «{self._nombre}» (servicios/minka_contrato.py)")

    def __dir__(self):
        return sorted(self._funciones)


TAREAS_V1 = _Superficie("tareas.v1", ("tarea", "crear"))
AGENDA_V1 = _Superficie("agenda.v1", ("evento", "parecido", "reunion_parecida", "sincronizar_documento",
                                      "registrar_actividades", "tipos", "modalidades"))


class _VinculosV1:
    """Resuelve cada nombre al usarlo y rechaza lo que no está en la lista (el contrato se cumple)."""

    def __getattr__(self, nombre: str):
        if nombre in FUNCIONES:
            return globals()[nombre]
        raise AttributeError(f"«{nombre}» no es parte de «vinculos.v1» (servicios/minka_contrato.py)")

    def __dir__(self):
        return sorted(FUNCIONES)


VINCULOS_V1 = _VinculosV1()
