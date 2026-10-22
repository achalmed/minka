"""API de la AGENDA (2026-10-06): eventos de la entidad (pleno, comisión, reuniones, medios,
semana de representación…) con participantes del equipo o del directorio, recurrencia semanal,
choques de horario, calendario ICS para suscribirse (Google, Outlook, Thunderbird, Super
Productivity) e importación de ICS con vista previa. Reglas puras en servicios/agenda_reglas.py.

El ICS por suscripción (`GET /api/agenda.ics?token=…`) no lleva la sesión (los calendarios
externos no la mandan): usa una dirección secreta por persona (tabla `agenda_tokens`), de solo
lectura, que se renueva o revoca desde la Agenda. Con la sesión, `GET /api/agenda/exportar.ics`.
"""

from __future__ import annotations

import re
import secrets
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from types import SimpleNamespace

from tiqsi.modulo import opcional
from tiqsi.puertos import Usuario, usuario_actual

from minka.modelos import AgendaToken, EventoAgenda, EventoParticipante, Tarea
from minka import agenda_reglas as ar
from minka import agenda_detectada
from minka import eventos as salida
from minka.config import config
from minka.db import obtener_sesion_minka
from minka import tareas as svc
from minka import tareas_reglas as reglas

router = APIRouter(prefix="/api/agenda", tags=["agenda"])
# Sin prefijo: la dirección que se pega en el calendario es /api/agenda.ics
router_ics = APIRouter(tags=["agenda"])

VENTANA_MAXIMA = timedelta(days=400)


def _puede_escribir(u: Usuario) -> None:
    if u.rol == "invitado":
        raise HTTPException(403, "La cuenta de invitado solo puede consultar.")


class ParticipanteEntrada(BaseModel):
    usuario_id: int | None = None
    persona_id: int | None = None
    nombre: str = ""
    rol: str = "acompana"
    confirmado: bool = False


class EventoEntrada(BaseModel):
    titulo: str = Field(min_length=1, max_length=300)
    descripcion: str = ""
    tipo: str = "otro"
    estado: str = "confirmado"
    inicio: datetime
    fin: datetime | None = None
    todo_el_dia: bool = False
    lugar: str = ""
    modalidad: str = "presencial"
    enlace: str = ""
    recurrencia: dict | None = None
    responsable_id: int | None = None
    participantes: list[ParticipanteEntrada] = []
    vinculos: list[str] = []
    version: int | None = None
    # Minutos antes del inicio; None = por omisión del tipo; 0 = sin recordatorio (2026-10-12).
    recordatorio_minutos: int | None = None


class VerificarEntrada(BaseModel):
    inicio: datetime
    fin: datetime | None = None
    todo_el_dia: bool = False
    tipo: str = "otro"
    recurrencia: dict | None = None
    participantes: list[ParticipanteEntrada] = []
    excluir_id: int | None = None


class OmitirEntrada(BaseModel):
    fecha: str  # AAAA-MM-DD de la ocurrencia


def _con_zona(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=svc.zona())


def _validar(datos: EventoEntrada) -> None:
    if datos.tipo not in ar.TIPOS:
        raise HTTPException(422, f"Tipo de evento desconocido: {datos.tipo}.")
    if datos.estado not in ar.ESTADOS:
        raise HTTPException(422, f"Estado desconocido: {datos.estado}.")
    if datos.modalidad not in ar.MODALIDADES:
        raise HTTPException(422, f"Modalidad desconocida: {datos.modalidad}.")
    if datos.fin is not None and _con_zona(datos.fin) < _con_zona(datos.inicio):
        raise HTTPException(422, "El fin no puede ser anterior al inicio.")
    for p in datos.participantes:
        if p.rol not in ar.ROLES_PARTICIPANTE:
            raise HTTPException(422, f"Rol de participante desconocido: {p.rol}.")
        if not (p.usuario_id or p.persona_id or p.nombre.strip()):
            raise HTTPException(422, "Cada participante es una cuenta, una persona del directorio o un nombre.")


def _clave_participante(p) -> str:
    if p.usuario_id:
        return f"u:{p.usuario_id}"
    if p.persona_id:
        return f"p:{p.persona_id}"
    return f"n:{(p.nombre or '').strip().lower()}"


def _ocurrencias(e, desde: datetime, hasta: datetime) -> list[tuple[datetime, datetime | None]]:
    if not e.todo_el_dia:
        return ar.ocurrencias(e.inicio, e.fin, e.recurrencia, e.excepciones, desde, hasta, svc.zona())
    # Todo el día: `fin` es el ÚLTIMO día (00:00, inclusive); para cruzar con la ventana
    # se toma hasta el final de ese día y se devuelve otra vez inclusive.
    uno = timedelta(days=1)
    ocs = ar.ocurrencias(e.inicio, (e.fin or e.inicio) + uno, e.recurrencia, e.excepciones, desde, hasta, svc.zona())
    return [(i, (f - uno) if e.fin and f else None) for i, f in ocs]


async def _eventos_en(sesion: AsyncSession, desde: datetime, hasta: datetime, extra=None, con_solicitudes: bool = False) -> list[EventoAgenda]:
    """Eventos que PUEDEN tener ocurrencias en la ventana: los únicos que la tocan y las series
    que empezaron antes de su fin. Sin las solicitudes (por confirmar o descartadas: 2026-10-18),
    salvo `con_solicitudes`: el calendario, el día, los choques y la programación solo ven lo
    confirmado."""
    condicion = or_(
        and_(EventoAgenda.recurrencia.is_(None), EventoAgenda.inicio < hasta,
             or_(EventoAgenda.fin > desde - timedelta(days=1), and_(EventoAgenda.fin.is_(None), EventoAgenda.inicio > desde - timedelta(days=1)))),
        and_(EventoAgenda.recurrencia.is_not(None), EventoAgenda.inicio < hasta),
    )
    consulta = select(EventoAgenda).where(condicion)
    if not con_solicitudes:
        consulta = consulta.where(EventoAgenda.estado.notin_(ar.SOLICITUD))
    if extra is not None:
        consulta = consulta.where(extra)
    return list((await sesion.execute(consulta.order_by(EventoAgenda.inicio))).scalars().all())


async def _expandir(sesion: AsyncSession, eventos: list[EventoAgenda], desde: datetime, hasta: datetime) -> tuple[list[dict], list[dict]]:
    """(ocurrencias serializadas, choques)."""
    datos = await svc.serializar_eventos(sesion, eventos)
    tz = svc.zona()
    ocs: list[dict] = []
    for e in eventos:
        for i, f in _ocurrencias(e, desde, hasta):
            fecha = i.astimezone(tz).date().isoformat()
            ocs.append({
                **datos[e.id],
                "clave": f"{e.id}:{fecha}",
                "ocurrencia": fecha,
                "inicio": i.astimezone(tz).isoformat(),
                "fin": f.astimezone(tz).isoformat() if f else None,
                "serie_inicio": datos[e.id]["inicio"],
                "_i": i, "_f": f,
            })
    ocs.sort(key=lambda o: o["_i"])
    cruces = ar.choques([
        {"clave": o["clave"], "id": o["id"], "titulo": o["titulo"], "tipo": o["tipo"], "estado": o["estado"],
         "inicio": o["_i"], "fin": o["_f"], "todo_el_dia": o["todo_el_dia"],
         "participantes": {p["clave"] for p in o["participantes"]}}
        for o in ocs
    ])
    nombres = {p["clave"]: p["nombre"] for o in ocs for p in o["participantes"]}
    for c in cruces:
        c["desde"] = c["desde"].astimezone(tz).isoformat()
        c["hasta"] = c["hasta"].astimezone(tz).isoformat()
        c["comparten"] = [nombres.get(k, k) for k in c["comparten"]]
    con_choque = {c["a"] for c in cruces} | {c["b"] for c in cruces}
    for o in ocs:
        o.pop("_i")
        o.pop("_f")
        o["choque"] = o["clave"] in con_choque
    return ocs, cruces


def _ventana(desde: str | None, hasta: str | None) -> tuple[datetime, datetime]:
    tz = svc.zona()
    try:
        d = date.fromisoformat(desde[:10]) if desde else reglas.ahora_utc().astimezone(tz).date()
        h = date.fromisoformat(hasta[:10]) if hasta else d + timedelta(days=7)
    except ValueError:
        raise HTTPException(422, "Fechas de la ventana: AAAA-MM-DD.")
    ini = datetime.combine(d, time(0), tz)
    fin = datetime.combine(h, time(0), tz) + timedelta(days=1)  # `hasta` incluido
    if fin <= ini or fin - ini > VENTANA_MAXIMA:
        raise HTTPException(422, "La ventana debe ser de 1 a 400 días.")
    return ini, fin


# --- consultas -----------------------------------------------------------------------------


@router.get("/opciones")
async def opciones(usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    return {
        "tipos": [{"clave": k, "nombre": v} for k, v in ar.TIPOS.items()],
        "estados": [{"clave": k, "nombre": v} for k, v in ar.ESTADOS.items()],
        "modalidades": [{"clave": k, "nombre": v} for k, v in ar.MODALIDADES.items()],
        "roles": [{"clave": k, "nombre": v} for k, v in ar.ROLES_PARTICIPANTE.items()],
        "usuarios": await svc.usuarios_activos(sesion),
        "zona_horaria": config.zona_horaria,
        "yo": usuario.id,
        "puede_escribir": usuario.rol != "invitado",
    }


@router.get("/eventos")
async def listar(
    desde: str | None = None,
    hasta: str | None = None,
    tipo: str | None = None,
    usuario_id: int | None = Query(None, description="Solo donde participa (o es responsable) esta cuenta"),
    entidad: str | None = Query(None, description="Vinculados a `doc:12`, `pl:3`, `sr:2`…"),
    con_solicitudes: bool = Query(False, description="También lo por confirmar y lo descartado (la ficha de un documento)"),
    usuario: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_minka),
) -> dict:
    """Ocurrencias en la ventana [desde, hasta] (fechas incluidas; por omisión, 7 días desde
    hoy) con sus choques. Solo lo confirmado: lo por confirmar está en `GET /por-confirmar`."""
    ini, fin = _ventana(desde, hasta)
    extra = []
    if tipo:
        extra.append(EventoAgenda.tipo.in_(tipo.split(",")))
    if usuario_id:
        ids = select(EventoParticipante.evento_id).where(EventoParticipante.usuario_id == usuario_id)
        extra.append(or_(EventoAgenda.id.in_(ids), EventoAgenda.responsable_id == usuario_id))
    if entidad:
        ids = await svc.origenes_con(sesion, entidad.strip(), "evento")
        extra.append(EventoAgenda.id.in_(ids or [0]))
    eventos = await _eventos_en(sesion, ini, fin, and_(*extra) if extra else None, con_solicitudes)
    ocs, cruces = await _expandir(sesion, eventos, ini, fin)
    return {"desde": ini.isoformat(), "hasta": fin.isoformat(), "eventos": ocs, "choques": cruces,
            "por_confirmar": await _cuantos_por_confirmar(sesion)}


async def _cuantos_por_confirmar(sesion: AsyncSession) -> int:
    desde = reglas.ahora_utc() - timedelta(days=DIAS_ATRAS_POR_CONFIRMAR)
    return (await sesion.execute(select(func.count()).select_from(EventoAgenda).where(
        EventoAgenda.estado == ar.POR_CONFIRMAR, EventoAgenda.inicio >= desde))).scalar_one()


# Lo pedido para una fecha ya pasada sigue en la lista una semana (para descartarlo o moverlo).
DIAS_ATRAS_POR_CONFIRMAR = 7


@router.get("/por-confirmar")
async def por_confirmar(
    descartadas: bool = Query(False, description="Las descartadas de los últimos 60 días, en vez de lo por confirmar"),
    usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka),
) -> dict:
    """La lista «Por confirmar» (2026-10-18): lo solicitado (gremios, instituciones, documentos
    recibidos, lo detectado en un oficio) que aún no está en el calendario, por fecha, con lo que
    ya ocupa esa hora en la agenda confirmada. Desde ella se mueve, se confirma o se descarta."""
    ahora = reglas.ahora_utc()
    if descartadas:
        cond = and_(EventoAgenda.estado == "descartado", EventoAgenda.actualizado_en >= ahora - timedelta(days=60))
    else:
        cond = and_(EventoAgenda.estado == ar.POR_CONFIRMAR, EventoAgenda.inicio >= ahora - timedelta(days=DIAS_ATRAS_POR_CONFIRMAR))
    filas = list((await sesion.execute(select(EventoAgenda).where(cond).order_by(EventoAgenda.inicio).limit(300))).scalars().all())
    datos = await svc.serializar_eventos(sesion, filas)
    salida = []
    for e in filas:
        d = datos[e.id]
        d["pasado"] = e.inicio < ahora
        d["choques"] = []
        if not descartadas and not e.todo_el_dia and not d["pasado"]:
            v = VerificarEntrada(inicio=e.inicio, fin=e.fin, tipo=e.tipo, recurrencia=e.recurrencia, excluir_id=e.id,
                                 participantes=[ParticipanteEntrada(**{k: p[k] for k in ("usuario_id", "persona_id", "nombre", "rol", "confirmado")}) for p in d["participantes"]])
            d["choques"] = (await verificar(v, usuario, sesion))["choques"]
        salida.append(d)
    return {"eventos": salida, "total": len(salida)}


@router.get("/feriados")
async def feriados(desde: str, hasta: str, _: Usuario = Depends(usuario_actual)) -> list[dict]:
    """Feriados, días no laborables y fechas cívicas del Perú en [desde, hasta] («calendario.v1»; sin él, ninguno)."""
    fer = opcional("calendario.v1")
    try:
        d, h = date.fromisoformat(desde[:10]), date.fromisoformat(hasta[:10])
    except ValueError:
        raise HTTPException(422, "Fechas: AAAA-MM-DD.") from None
    if h < d or (h - d).days > 400:
        raise HTTPException(422, "La ventana debe ser de 1 a 400 días.")
    return fer.entre(d, h) if fer is not None else []


@router.get("/hoy")
async def hoy(usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """La agenda de hoy (de la entidad) con sus choques y las tareas de la persona para hoy
    (incluidas las vencidas): lo que muestran el Inicio y la vista «Hoy»."""
    tz = svc.zona()
    d = reglas.ahora_utc().astimezone(tz).date()
    ini, fin = datetime.combine(d, time(0), tz), datetime.combine(d, time(0), tz) + timedelta(days=1)
    ocs, cruces = await _expandir(sesion, await _eventos_en(sesion, ini, fin), ini, fin)
    tareas = (await sesion.execute(
        select(Tarea).where(Tarea.responsable_id == usuario.id, Tarea.estado.in_(reglas.ABIERTOS),
                            Tarea.vence_en.is_not(None), Tarea.vence_en < fin).order_by(Tarea.vence_en).limit(80)
    )).scalars().all()
    datos = await svc.serializar_tareas(sesion, list(tareas))
    datos.sort(key=reglas.orden_lista)
    return {"fecha": d.isoformat(), "eventos": ocs, "choques": cruces, "tareas": datos, "por_confirmar": await _cuantos_por_confirmar(sesion)}


@router.post("/verificar")
async def verificar(datos: VerificarEntrada, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """¿Choca este evento (aún sin guardar) con la agenda? Mira las próximas 8 semanas de la
    serie, o el día del evento único."""
    inicio = _con_zona(datos.inicio)
    fin_ev = _con_zona(datos.fin) if datos.fin else None
    ventana_fin = inicio + (timedelta(weeks=8) if datos.recurrencia else timedelta(days=1, hours=1))
    ventana_ini = inicio - timedelta(hours=1)
    extra = EventoAgenda.id != datos.excluir_id if datos.excluir_id else None
    eventos = await _eventos_en(sesion, ventana_ini, ventana_fin, extra)
    ocs, _ = await _expandir(sesion, eventos, ventana_ini, ventana_fin)
    propio = ar.ocurrencias(inicio, fin_ev, datos.recurrencia, [], ventana_ini, ventana_fin, svc.zona())
    claves = {_clave_participante(p) for p in datos.participantes}
    candidatas = [
        {"clave": f"nuevo:{i.isoformat()}", "id": -1, "titulo": "(este evento)", "tipo": datos.tipo, "estado": "confirmado",
         "inicio": i, "fin": f, "todo_el_dia": datos.todo_el_dia, "participantes": claves}
        for i, f in propio
    ] + [
        {"clave": o["clave"], "id": o["id"], "titulo": o["titulo"], "tipo": o["tipo"], "estado": o["estado"],
         "inicio": datetime.fromisoformat(o["inicio"]), "fin": datetime.fromisoformat(o["fin"]) if o["fin"] else None,
         "todo_el_dia": o["todo_el_dia"], "participantes": {p["clave"] for p in o["participantes"]}}
        for o in ocs
    ]
    nombres = {p["clave"]: p["nombre"] for o in ocs for p in o["participantes"]}
    salida = []
    for c in ar.choques(candidatas):
        if c["a"].startswith("nuevo:") == c["b"].startswith("nuevo:"):
            continue  # entre otros eventos ya existentes: no es de este
        otro = c["b"] if c["a"].startswith("nuevo:") else c["a"]
        titulo = c["titulo_b"] if c["a"].startswith("nuevo:") else c["titulo_a"]
        salida.append({"clave": otro, "titulo": titulo, "desde": c["desde"].astimezone(svc.zona()).isoformat(), "hasta": c["hasta"].astimezone(svc.zona()).isoformat(),
                       "gravedad": c["gravedad"], "comparten": [nombres.get(k, k) for k in c["comparten"]]})
    return {"choques": salida}


class PegarEntrada(BaseModel):
    texto: str = Field(min_length=1, max_length=60000)
    vinculos: list[str] = []      # p. ej. ['entrada:12'] cuando se pega desde un recibido


@router.post("/pegar")
async def pegar(datos: PegarEntrada, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """El resultado del prompt de agenda pegado (bloque `agenda-actividades`) → vista previa
    de cada actividad: el evento listo para `POST /eventos`, el evento parecido que ya está
    (para vincular en vez de duplicar), los choques, y quién del equipo o del directorio es
    cada participante. No escribe nada (2026-10-11, servicios/pegado)."""
    svc_pegado = opcional("pegado.v1")
    if svc_pegado is None:
        raise HTTPException(503, "Leer lo pegado no está disponible aquí.")
    _puede_escribir(usuario)
    le = svc_pegado.interpretar(datos.texto, ("agenda-actividades",))
    if not le.valido:
        raise HTTPException(422, {"codigo": "pegado_invalido", "errores": le.errores, "avisos": le.avisos,
                                  "formatos": [f for f in svc_pegado.formatos() if f["tipo"] == "agenda-actividades"]})
    equipo = [c for c in await svc.identidad.cuentas() if c["activo"]]
    directorio = opcional("personas.v1")
    personas = await directorio.activas() if directorio is not None else []
    bloque = le.esquema.bloque("actividad")
    etiquetas = {k: d.get("etiqueta") or k for k, d in bloque.items()}
    actividades = []
    for i, a in enumerate(le.valores.get("actividades") or [], 1):
        inicio = a["inicio"] if "T" in a["inicio"] else f"{a['inicio']}T00:00:00"
        todo_el_dia = bool(a.get("todo_el_dia")) or "T" not in a["inicio"]
        fin = a.get("fin") if a.get("fin") and "T" in a.get("fin", "") else None
        descripcion = [a["descripcion"]] if a.get("descripcion") else []
        for k in ("convoca", "confirmacion", "accion_previa", "prioridad"):
            if a.get(k):
                descripcion.append(f"{etiquetas.get(k, k)}: {a[k]}")
        participantes, sin_casar = [], []
        for nombre in a.get("participa") or []:
            p = _casar_participante(nombre, equipo, personas)
            (participantes if p else sin_casar).append(p or nombre)
        responsable_id = None
        if a.get("responsable"):
            r = _casar_participante(a["responsable"], equipo, [])
            responsable_id = r["usuario_id"] if r else None
        evento = {
            "titulo": a["titulo"][:300], "descripcion": "\n".join(descripcion), "tipo": a.get("tipo") or "otro",
            "estado": ar.estado_de_pegado(a.get("confirmacion")), "inicio": inicio, "fin": fin, "todo_el_dia": todo_el_dia,
            "lugar": (a.get("lugar") or "")[:300], "modalidad": a.get("modalidad") or "presencial",
            "enlace": a.get("enlace") or "", "responsable_id": responsable_id,
            "participantes": participantes, "vinculos": list(datos.vinculos),
            "recordatorio_minutos": a.get("recordatorio"),
        }
        existente = await svc.evento_parecido(sesion, evento["titulo"], inicio, todo_el_dia)
        verificacion = VerificarEntrada(inicio=datetime.fromisoformat(inicio), fin=datetime.fromisoformat(fin) if fin else None,
                                        todo_el_dia=todo_el_dia, tipo=evento["tipo"],
                                        participantes=[ParticipanteEntrada(**p) for p in participantes])
        choques_ = (await verificar(verificacion, usuario, sesion))["choques"] if not todo_el_dia else []
        actividades.append({
            "n": i, "evento": evento, "existente": existente, "choques": choques_,
            "participantes_sin_casar": sin_casar, "documento": a.get("documento") or "",
            "recordatorio_minutos": a.get("recordatorio"),
            "dudas": {k.split(".", 1)[1]: v for k, v in le.dudas.items() if k.startswith(f"actividades[{i}].")},
            "estado": "existente" if existente else ("con_choques" if choques_ else "nuevo"),
        })
    return {"lectura": le.como_dict(), "actividades": actividades, "resto": le.resto}


def _casar_participante(nombre: str, equipo: list[dict], personas: list[dict]) -> dict | None:
    """Un nombre del pegado → el participante del equipo (por nombre completo o cuenta; «identidad.v1») o del directorio
    (nombre completo contenido; «personas.v1»); None si nadie casa sin ambigüedad."""
    n = reglas.normalizar(nombre or "")
    if not n:
        return None
    del_equipo = [u for u in equipo if reglas.normalizar(u["nombre_completo"] or "") == n or reglas.normalizar(u["usuario"] or "") == n
                  or (len(n) >= 8 and n in reglas.normalizar(u["nombre_completo"] or ""))]
    if len(del_equipo) == 1:
        u = del_equipo[0]
        return {"usuario_id": u["id"], "persona_id": None, "nombre": u["nombre_completo"] or u["usuario"], "rol": "acompana", "confirmado": False}
    del_directorio = [p for p in personas if reglas.normalizar(p["nombre"] or "") == n or (len(n) >= 10 and n in reglas.normalizar(p["nombre"] or ""))]
    if len(del_directorio) == 1:
        p = del_directorio[0]
        return {"usuario_id": None, "persona_id": p["id"], "nombre": p["nombre"], "rol": "invitado", "confirmado": False}
    return None


@router.get("/eventos/{eid}")
async def ver(eid: int, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    e = await sesion.get(EventoAgenda, eid)
    if e is None:
        raise HTTPException(404, "El evento no existe.")
    return (await svc.serializar_eventos(sesion, [e]))[e.id]


# --- escritura -----------------------------------------------------------------------------


async def _poner_participantes(sesion: AsyncSession, e: EventoAgenda, lista: list[ParticipanteEntrada], quien: Usuario) -> None:
    anteriores = {p.usuario_id for p in (await sesion.execute(
        select(EventoParticipante).where(EventoParticipante.evento_id == e.id)
    )).scalars().all() if p.usuario_id}
    await sesion.execute(delete(EventoParticipante).where(EventoParticipante.evento_id == e.id))
    vistas: set[str] = set()
    for p in lista[:60]:
        clave = _clave_participante(p)
        if clave in vistas:
            continue
        vistas.add(clave)
        if p.usuario_id and await svc.identidad.cuenta(p.usuario_id) is None:
            raise HTTPException(422, "Un participante no es una cuenta del sistema.")
        if p.persona_id:
            directorio = opcional("personas.v1")
            if directorio is None or not await directorio.existe(p.persona_id):
                raise HTTPException(422, "Un participante no está en el directorio.")
        sesion.add(EventoParticipante(evento_id=e.id, usuario_id=p.usuario_id, persona_id=p.persona_id,
                                      nombre=p.nombre.strip()[:200], rol=p.rol, confirmado=p.confirmado))
        if p.usuario_id and p.usuario_id not in anteriores:
            cuando = e.inicio.astimezone(svc.zona()).strftime("%d/%m %H:%M") if not e.todo_el_dia else e.inicio.astimezone(svc.zona()).strftime("%d/%m")
            salida.avisar(sesion, p.usuario_id, f"Agenda: lo incluyeron en «{e.titulo[:150]}» ({cuando})", "agenda",
                          evitar=quien.id, destino=f"evento:{e.id}")


def _aplicar(e: EventoAgenda, datos: EventoEntrada) -> None:
    tz = svc.zona()
    inicio_antes = e.inicio
    inicio = _con_zona(datos.inicio)
    fin = _con_zona(datos.fin) if datos.fin else None
    if datos.todo_el_dia:
        inicio = datetime.combine(inicio.astimezone(tz).date(), time(0), tz)
        fin = datetime.combine(fin.astimezone(tz).date(), time(0), tz) if fin else None
    e.titulo = datos.titulo.strip()
    e.descripcion = datos.descripcion
    e.tipo, e.estado, e.modalidad = datos.tipo, datos.estado, datos.modalidad
    e.inicio, e.fin, e.todo_el_dia = inicio, fin, datos.todo_el_dia
    e.lugar = datos.lugar.strip()[:300]
    e.enlace = datos.enlace.strip()
    e.recurrencia = ar.limpiar_recurrencia(datos.recurrencia)
    e.responsable_id = datos.responsable_id
    if datos.recordatorio_minutos is not None and datos.recordatorio_minutos < 0:
        datos.recordatorio_minutos = None
    if e.recordatorio_minutos != datos.recordatorio_minutos or inicio_antes != e.inicio:
        e.recordatorio_avisado_en = None  # un cambio de hora o de aviso vuelve a avisar
    e.recordatorio_minutos = datos.recordatorio_minutos


@router.post("/eventos")
async def crear(datos: EventoEntrada, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    _puede_escribir(usuario)
    _validar(datos)
    e = EventoAgenda(creado_por=usuario.id, actualizado_por=usuario.id, excepciones=[])
    _aplicar(e, datos)
    sesion.add(e)
    await sesion.flush()
    await _poner_participantes(sesion, e, datos.participantes, usuario)
    await svc.poner_vinculos(sesion, f"evento:{e.id}", datos.vinculos, usuario.id)
    await svc.anunciar_evento(sesion, e, usuario)
    await sesion.commit()
    return (await svc.serializar_eventos(sesion, [e]))[e.id]


@router.put("/eventos/{eid}")
async def cambiar(eid: int, datos: EventoEntrada, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """Reemplaza el evento (toda la serie si se repite). Reenviar todo: lo que no viaja se borra."""
    _puede_escribir(usuario)
    _validar(datos)
    e = await sesion.get(EventoAgenda, eid)
    if e is None:
        raise HTTPException(404, "El evento no existe.")
    if datos.version is not None and datos.version != e.version:
        raise HTTPException(409, {"codigo": "evento_modificado", "mensaje": "Otra persona cambió este evento: se recargó la versión vigente."})
    era_solicitud = not ar.en_calendario(e.estado)
    _aplicar(e, datos)
    e.version += 1
    e.actualizado_por = usuario.id
    await _poner_participantes(sesion, e, datos.participantes, usuario)
    await svc.poner_vinculos(sesion, f"evento:{e.id}", datos.vinculos, usuario.id)
    if era_solicitud:
        await svc.anunciar_evento(sesion, e, usuario)  # confirmado desde la ficha
    await sesion.commit()
    await svc.propagar(f"evento:{e.id}")
    await sesion.refresh(e)
    return (await svc.serializar_eventos(sesion, [e]))[e.id]


class VincularEntrada(BaseModel):
    destino: str  # «entrada:12», «doc:3»…


@router.post("/eventos/{eid}/vincular")
async def vincular(eid: int, datos: VincularEntrada, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """Añade UN vínculo al evento sin tocar lo demás (p. ej. el recibido que lo cita, desde
    Recibidos); los que ya tenía se conservan."""
    _puede_escribir(usuario)
    e = await sesion.get(EventoAgenda, eid)
    if e is None:
        raise HTTPException(404, "El evento no existe.")
    if not reglas.vinculo_valido(datos.destino):
        raise HTTPException(422, "Vínculo no válido.")
    origen = f"evento:{e.id}"
    actuales = (await svc.vinculos_de(sesion, [origen])).get(origen, [])
    await svc.poner_vinculos(sesion, origen, [*actuales, datos.destino.strip()], usuario.id)
    e.actualizado_por = usuario.id
    await sesion.commit()
    return (await svc.serializar_eventos(sesion, [e]))[e.id]


@router.post("/eventos/{eid}/omitir")
async def omitir(eid: int, datos: OmitirEntrada, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """Quita UNA ocurrencia de una serie («no habrá sesión este martes»); la serie sigue."""
    _puede_escribir(usuario)
    e = await sesion.get(EventoAgenda, eid)
    if e is None:
        raise HTTPException(404, "El evento no existe.")
    try:
        fecha = date.fromisoformat(datos.fecha[:10]).isoformat()
    except ValueError:
        raise HTTPException(422, "Fecha AAAA-MM-DD.")
    if not e.recurrencia:
        raise HTTPException(422, "Solo una serie tiene ocurrencias que omitir; un evento único se suspende o se elimina.")
    e.excepciones = sorted(set(e.excepciones or []) | {fecha})
    e.version += 1
    e.actualizado_por = usuario.id
    await sesion.commit()
    return {"ok": True, "excepciones": e.excepciones}


@router.post("/eventos/{eid}/confirmar")
async def confirmar(eid: int, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """Un clic para dar por buena una SOLICITUD (por confirmar, o descartada que se recupera):
    pasa al calendario sin reenviar el evento entero (2026-10-08, desde el visor del documento;
    2026-10-18, desde la lista «Por confirmar»). Entonces la cuenta el tema «Agenda» del chat."""
    _puede_escribir(usuario)
    e = await sesion.get(EventoAgenda, eid)
    if e is None:
        raise HTTPException(404, "El evento no existe.")
    if not ar.en_calendario(e.estado):
        e.estado = "confirmado"
        e.version += 1
        e.actualizado_por = usuario.id
        await svc.anunciar_evento(sesion, e, usuario)
        await sesion.commit()
        await sesion.refresh(e)
    return (await svc.serializar_eventos(sesion, [e]))[e.id]


class ReprogramarEntrada(BaseModel):
    inicio: datetime
    fin: datetime | None = None
    todo_el_dia: bool = False
    version: int | None = None


@router.post("/eventos/{eid}/reprogramar")
async def reprogramar(eid: int, datos: ReprogramarEntrada, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """Cambia SOLO la fecha y la hora (el diputado suele moverlas, 2026-10-18): lo demás no viaja
    ni se toca. Un fin sin enviar conserva la duración que tenía."""
    _puede_escribir(usuario)
    e = await sesion.get(EventoAgenda, eid)
    if e is None:
        raise HTTPException(404, "El evento no existe.")
    if datos.version is not None and datos.version != e.version:
        raise HTTPException(409, {"codigo": "evento_modificado", "mensaje": "Otra persona cambió este evento: se recargó la versión vigente."})
    tz = svc.zona()
    inicio = _con_zona(datos.inicio)
    duracion = (e.fin - e.inicio) if e.fin and not e.todo_el_dia else None
    fin = _con_zona(datos.fin) if datos.fin else (inicio + duracion if duracion and not datos.todo_el_dia else None)
    if datos.todo_el_dia:
        inicio = datetime.combine(inicio.astimezone(tz).date(), time(0), tz)
        fin = datetime.combine(fin.astimezone(tz).date(), time(0), tz) if fin else None
    if fin is not None and fin < inicio:
        raise HTTPException(422, "El fin no puede ser anterior al inicio.")
    if e.inicio != inicio:
        e.recordatorio_avisado_en = None
    e.inicio, e.fin, e.todo_el_dia = inicio, fin, datos.todo_el_dia
    e.version += 1
    e.actualizado_por = usuario.id
    await sesion.commit()
    await svc.propagar(f"evento:{e.id}")
    await sesion.refresh(e)
    return (await svc.serializar_eventos(sesion, [e]))[e.id]


@router.post("/eventos/{eid}/descartar")
async def descartar(eid: int, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """«No se hará» para una solicitud (2026-10-18): queda como descartada, con su historia y sus
    vínculos (el recibido del gremio sigue diciendo qué se pidió), fuera de la lista y del
    calendario. Lo detectado en un documento no vuelve a proponerse."""
    _puede_escribir(usuario)
    e = await sesion.get(EventoAgenda, eid)
    if e is None:
        raise HTTPException(404, "El evento no existe.")
    if e.estado != ar.POR_CONFIRMAR:
        raise HTTPException(422, "Solo se descarta lo que está por confirmar; un evento confirmado se cancela.")
    e.estado = "descartado"
    e.version += 1
    e.actualizado_por = usuario.id
    if e.origen == "detectado" and e.externo_id:
        await agenda_detectada.descartar_evento(sesion, e)
    await sesion.commit()
    await svc.propagar(f"evento:{e.id}")  # los mensajes del chat sobre el evento, al día (2026-10-18)
    await sesion.refresh(e)
    return (await svc.serializar_eventos(sesion, [e]))[e.id]


class ParecidoEntrada(BaseModel):
    titulo: str = Field(min_length=1, max_length=300)
    inicio: str = ""
    todo_el_dia: bool = False
    excluir_id: int | None = None


@router.post("/parecido")
async def parecido(datos: ParecidoEntrada, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """¿Ya está en la agenda (o por confirmar) algo parecido ese día? La ficha lo pregunta antes de
    agendar (2026-10-18), con el mismo criterio que el pegado y Recibidos."""
    ya = await svc.evento_parecido(sesion, datos.titulo, datos.inicio, datos.todo_el_dia)
    if ya and datos.excluir_id and ya["id"] == datos.excluir_id:
        ya = None
    return {"parecido": ya}


@router.delete("/eventos/{eid}")
async def eliminar(eid: int, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    _puede_escribir(usuario)
    e = await sesion.get(EventoAgenda, eid)
    if e is None:
        raise HTTPException(404, "El evento no existe.")
    # Un evento DETECTADO en un documento (servicios/agenda_detectada.py) lo puede borrar cualquiera
    # que escriba en la agenda; y no vuelve a proponerse.
    if e.origen != "detectado" and e.creado_por != usuario.id and usuario.rol != "administrador":
        raise HTTPException(403, "Solo quien creó el evento (o el administrador) puede eliminarlo; puede cancelarlo.")
    if e.origen == "detectado" and e.externo_id:
        await agenda_detectada.descartar_evento(sesion, e)
    await svc.quitar_vinculos(sesion, f"evento:{e.id}")
    await sesion.delete(e)
    await sesion.commit()
    return {"ok": True}


# --- ICS -----------------------------------------------------------------------------------


async def _ics(sesion: AsyncSession, u: Usuario, solo_mias: bool, con_tareas: bool) -> str:
    tz = svc.zona()
    ahora = reglas.ahora_utc()
    consulta = select(EventoAgenda).where(or_(EventoAgenda.recurrencia.is_not(None), EventoAgenda.inicio > ahora - timedelta(days=120)),
                                          EventoAgenda.estado.notin_(ar.SOLICITUD))
    if solo_mias:
        ids = select(EventoParticipante.evento_id).where(EventoParticipante.usuario_id == u.id)
        consulta = consulta.where(or_(EventoAgenda.id.in_(ids), EventoAgenda.responsable_id == u.id))
    eventos = (await sesion.execute(consulta.order_by(EventoAgenda.inicio).limit(3000))).scalars().all()
    filas = [
        {"uid": f"evento-{e.id}", "titulo": e.titulo, "descripcion": e.descripcion, "lugar": e.lugar, "enlace": e.enlace,
         "inicio": e.inicio, "fin": e.fin, "todo_el_dia": e.todo_el_dia, "recurrencia": e.recurrencia,
         "excepciones": e.excepciones, "estado": e.estado, "tipo": e.tipo, "actualizado": e.actualizado_en}
        for e in eventos
    ]
    if con_tareas:
        tareas = (await sesion.execute(
            select(Tarea).where(Tarea.responsable_id == u.id, Tarea.estado.in_(reglas.ABIERTOS), Tarea.vence_en.is_not(None))
            .limit(1000)
        )).scalars().all()
        for t in tareas:
            filas.append({
                "uid": f"tarea-{t.id}", "titulo": f"Tarea: {t.titulo[:200]}", "descripcion": t.descripcion,
                "inicio": t.vence_en if t.con_hora else datetime.combine(t.vence_en.astimezone(tz).date(), time(0), tz),
                "fin": (t.vence_en + timedelta(minutes=30)) if t.con_hora else None, "todo_el_dia": not t.con_hora,
                "estado": "confirmado", "actualizado": t.actualizado_en,
            })
    nombre = f"Agenda — {u.nombre_completo}" if solo_mias else "Agenda de la entidad"
    return ar.exportar_ics(filas, nombre, tz, ahora)


def _respuesta_ics(texto: str, descargar: bool) -> Response:
    cabeceras = {"Cache-Control": "no-cache, private"}
    if descargar:
        cabeceras["Content-Disposition"] = 'attachment; filename="agenda.ics"'
    return Response(content=texto, media_type="text/calendar; charset=utf-8", headers=cabeceras)


@router.get("/exportar.ics")
async def exportar(
    solo_mias: bool = False, tareas: bool = False,
    usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka),
) -> Response:
    return _respuesta_ics(await _ics(sesion, usuario, solo_mias, tareas), True)


@router_ics.get("/api/agenda.ics")
async def suscripcion(
    token: str = Query(min_length=20, max_length=80), solo_mias: bool = False, tareas: bool = False,
    sesion: AsyncSession = Depends(obtener_sesion_minka),
) -> Response:
    fila = (await sesion.execute(select(AgendaToken).where(AgendaToken.token == token))).scalar_one_or_none()
    if fila is None:
        raise HTTPException(404, "Dirección de calendario desconocida o revocada.")
    c = await svc.identidad.cuenta(fila.usuario_id)
    if c is None or not c["activo"]:
        raise HTTPException(404, "Dirección de calendario desconocida o revocada.")
    u = SimpleNamespace(**c)
    texto = await _ics(sesion, u, solo_mias, tareas)
    fila.usado_en = reglas.ahora_utc()
    await sesion.commit()
    return _respuesta_ics(texto, False)


@router.get("/token")
async def ver_token(usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    fila = await sesion.get(AgendaToken, usuario.id)
    return {"token": fila.token if fila else None, "usado_en": fila.usado_en.isoformat() if fila and fila.usado_en else None}


@router.post("/token")
async def renovar_token(usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """Crea (o renueva: la anterior deja de servir) la dirección secreta del calendario."""
    fila = await sesion.get(AgendaToken, usuario.id)
    nuevo = secrets.token_urlsafe(32)
    if fila is None:
        sesion.add(AgendaToken(usuario_id=usuario.id, token=nuevo))
    else:
        fila.token, fila.usado_en = nuevo, None
    await sesion.commit()
    return {"token": nuevo, "usado_en": None}


@router.delete("/token")
async def revocar_token(usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    await sesion.execute(delete(AgendaToken).where(AgendaToken.usuario_id == usuario.id))
    await sesion.commit()
    return {"token": None}


@router.post("/importar-ics")
async def importar_ics(
    archivo: UploadFile = File(...), aplicar: bool = False, tipo: str = "otro",
    usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka),
) -> dict:
    """Eventos de un .ics (Google Calendar, Outlook, una citación) → agenda. SIMULA por
    omisión; escribe con `aplicar=true`. Lo ya importado (mismo UID) se omite."""
    _puede_escribir(usuario)
    if tipo not in ar.TIPOS:
        raise HTTPException(422, "Tipo de evento desconocido.")
    crudo = await archivo.read()
    if len(crudo) > 10 * 1024 * 1024:
        raise HTTPException(413, "El calendario pasa de 10 MB.")
    try:
        texto = crudo.decode("utf-8-sig")
    except UnicodeDecodeError:
        texto = crudo.decode("latin-1")
    if "BEGIN:VCALENDAR" not in texto.upper():
        raise HTTPException(422, "El archivo no es un calendario ICS.")
    eventos, avisos_ics = ar.importar_ics(texto, svc.zona())
    uids = [e["externo_id"] for e in eventos if e["externo_id"]]
    ya = set((await sesion.execute(select(EventoAgenda.externo_id).where(EventoAgenda.externo_id.in_(uids or ["-"])))).scalars().all())
    # Un evento que salió de ESTE sistema (UID `evento-N@qillqa` del calendario propio; `@sgdp` en los exportados antes del
    # 2026-10-22) ya está.
    propios = {int(m.group(1)) for e in eventos if (m := re.fullmatch(r"evento-(\d+)@(?:qillqa|sgdp)", e["externo_id"] or ""))}
    if propios:
        existentes = set((await sesion.execute(select(EventoAgenda.id).where(EventoAgenda.id.in_(propios)))).scalars().all())
        ya |= {f"evento-{i}@{d}" for i in existentes for d in ("qillqa", "sgdp")}
    nuevos = [e for e in eventos if not e["externo_id"] or e["externo_id"] not in ya]
    resumen = {
        "aplicado": False,
        "nuevos": len(nuevos),
        "ya_importados": len(eventos) - len(nuevos),
        "avisos": avisos_ics[:30],
        "muestra": [
            {"titulo": e["titulo"], "inicio": e["inicio"].astimezone(svc.zona()).isoformat(),
             "fin": e["fin"].astimezone(svc.zona()).isoformat() if e["fin"] else None,
             "todo_el_dia": e["todo_el_dia"], "lugar": e["lugar"], "repite": bool(e["recurrencia"])}
            for e in nuevos[:25]
        ],
    }
    if not aplicar:
        return resumen
    for e in nuevos:
        sesion.add(EventoAgenda(
            titulo=e["titulo"], descripcion=e["descripcion"], tipo=tipo, estado=e["estado"], inicio=e["inicio"], fin=e["fin"],
            todo_el_dia=e["todo_el_dia"], lugar=e["lugar"], enlace=e["enlace"], modalidad="virtual" if e["enlace"] else "presencial",
            recurrencia=e["recurrencia"], excepciones=e["excepciones"], origen="ics", externo_id=e["externo_id"],
            creado_por=usuario.id,
        ))
    await sesion.commit()
    resumen["aplicado"] = True
    return resumen
