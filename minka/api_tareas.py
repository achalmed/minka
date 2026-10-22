"""API de TAREAS (2026-10-06): módulo propio de Qillqa, inspirado en Todoist (alta rápida),
Trello (tablero), OpenProject (responsable, estados, plazos) y Super Productivity (listas de
verificación, importación de su respaldo). Reglas puras en servicios/tareas_reglas.py; base en
servicios/tareas.py. Permisos: el rol invitado solo lee; borrar, quien la creó o el
administrador. Las tareas son de la entidad (todo el equipo las ve), como un tablero común.
"""

from __future__ import annotations

import json
import re
from datetime import date, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from tiqsi.modulo import opcional
from tiqsi.puertos import Usuario, usuario_actual

from minka.modelos import ListaTareas, Tarea, TareaComentario
from minka import superproductivity as sp
from minka import tareas as svc
from minka import tareas_automaticas
from minka import tareas_reglas as reglas
from minka.db import obtener_sesion_minka

router = APIRouter(prefix="/api/tareas", tags=["tareas"])


def _puede_escribir(u: Usuario) -> None:
    if u.rol == "invitado":
        raise HTTPException(403, "La cuenta de invitado solo puede consultar.")


class TareaEntrada(BaseModel):
    titulo: str = Field(min_length=1, max_length=1000)
    descripcion: str = ""
    estado: str = "por_hacer"
    prioridad: str = "normal"
    importante: bool = False
    responsable_id: int | None = None
    vence_fecha: str | None = None  # AAAA-MM-DD
    vence_hora: str | None = None   # HH:MM
    lista_id: int | None = None
    etiquetas: list[str] = []
    checklist: list[dict] = []
    vinculos: list[str] = []
    plantilla: str = ""
    clase: str = ""  # interna | externa | "" = la decide el sistema (2026-10-18)


class TareaCambio(BaseModel):
    titulo: str | None = Field(default=None, min_length=1, max_length=1000)
    descripcion: str | None = None
    estado: str | None = None
    prioridad: str | None = None
    importante: bool | None = None
    responsable_id: int | None = None
    quitar_responsable: bool = False
    vence_fecha: str | None = None
    vence_hora: str | None = None
    quitar_plazo: bool = False
    lista_id: int | None = None
    quitar_lista: bool = False
    orden: int | None = None
    etiquetas: list[str] | None = None
    checklist: list[dict] | None = None
    vinculos: list[str] | None = None
    entregable: str | None = None
    clase: str | None = None  # interna | externa | "" = la del sistema
    # Versión que se leyó: si otro guardó antes, 409 (no se pisa su cambio).
    version: int | None = None


class RapidaEntrada(BaseModel):
    texto: str = Field(min_length=1, max_length=1000)
    vista_previa: bool = False
    vinculos: list[str] = []
    lista_id: int | None = None
    # El día en que se escribió (2026-10-18): una tarea creada sin servidor sale de la cola del
    # navegador después, y «mañana» debe ser mañana respecto de ese día. Ver dia_de_referencia().
    escrito_el: date | None = None


def dia_de_referencia(hoy: date, escrito_el: date | None) -> date:
    """El «hoy» con que se interpreta un alta rápida: el día en que se escribió si es de los
    últimos 30 días (una cola sin servidor), nunca uno futuro ni uno muy viejo."""
    if escrito_el is None or escrito_el > hoy or (hoy - escrito_el).days > 30:
        return hoy
    return escrito_el


class PlantillaEntrada(BaseModel):
    plantilla: str
    titulo: str = ""
    fecha_referencia: str  # AAAA-MM-DD
    responsable_id: int | None = None
    vinculos: list[str] = []
    separar: bool = False


class ComentarioEntrada(BaseModel):
    texto: str = Field(min_length=1, max_length=5000)


class ListaEntrada(BaseModel):
    nombre: str = Field(min_length=1, max_length=120)
    descripcion: str = ""
    color: str = ""
    archivada: bool = False


def _validar_clase(clase: str | None) -> None:
    if clase and clase not in reglas.CLASES:
        raise HTTPException(422, f"Clase de tarea desconocida: {clase}.")


def _validar(estado: str | None, prioridad: str | None) -> None:
    if estado is not None and estado not in reglas.ESTADOS:
        raise HTTPException(422, f"Estado desconocido: {estado}.")
    if prioridad is not None and prioridad not in reglas.PRIORIDADES:
        raise HTTPException(422, f"Prioridad desconocida: {prioridad}.")


def _plazo(fecha: str | None, hora: str | None):
    try:
        return reglas.plazo(fecha, hora, svc.zona())
    except ValueError:
        raise HTTPException(422, "Fecha u hora del plazo no válida (AAAA-MM-DD y HH:MM).")


async def _responsable_valido(sesion: AsyncSession, uid: int | None) -> None:
    if uid is None:
        return
    u = await svc.identidad.cuenta(uid)
    if u is None or not u["activo"]:
        raise HTTPException(422, "El responsable no es una cuenta activa.")


async def _tarea(sesion: AsyncSession, tid: int) -> Tarea:
    t = await sesion.get(Tarea, tid)
    if t is None:
        raise HTTPException(404, "La tarea no existe.")
    return t


def _bitacora(sesion: AsyncSession, t: Tarea, u: Usuario, texto: str) -> None:
    sesion.add(TareaComentario(tarea_id=t.id, usuario_id=u.id, texto=texto, sistema=True))


def _cambiar_estado(sesion: AsyncSession, t: Tarea, nuevo: str, u: Usuario) -> None:
    if nuevo == t.estado:
        return
    anterior = t.estado
    t.estado = nuevo
    if nuevo in reglas.CERRADOS:
        t.cerrada_en = reglas.ahora_utc()
        t.cerrada_por = u.id
    else:
        t.cerrada_en = None
        t.cerrada_por = None
    _bitacora(sesion, t, u, f"Estado: {reglas.ETIQUETA_ESTADO[anterior]} → {reglas.ETIQUETA_ESTADO[nuevo]}")
    # Quien la encargó se entera de que se cerró (si no la cerró él).
    if nuevo == "hecha" and t.creado_por and t.creado_por != u.id:
        from minka import eventos as salida

        salida.avisar(sesion, t.creado_por, f"Tarea hecha por {u.nombre_completo}: {t.titulo[:200]}", "tarea",
                      evitar=u.id, destino=f"tarea:{t.id}")


# --- consultas -----------------------------------------------------------------------------


@router.get("")
async def listar(
    vista: str = "todas",
    responsable_id: int | None = None,
    estado: str | None = Query(None, description="Uno o varios, separados por coma"),
    lista_id: int | None = None,
    entidad: str | None = Query(None, description="Vinculadas a `doc:12`, `pl:3`, `persona:7`…"),
    etiqueta: str | None = None,
    q: str | None = None,
    incluir_cerradas: bool = False,
    cerradas_dias: int | None = Query(None, ge=1, le=90, description="Las abiertas y las cerradas en los últimos N días («Mis tareas» → Hechas)"),
    limite: int = Query(500, le=2000),
    usuario: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_minka),
) -> dict:
    """Tareas con filtros. Vistas: todas, mias, hoy (incluye lo vencido), vencidas, semana
    (hoy y los 7 días siguientes), sin_fecha, hechas."""
    if vista not in reglas.VISTAS:
        raise HTTPException(422, f"Vista desconocida: {vista}.")
    # Lo que el sistema ya sabe que hay que hacer entra solo (recibidos, encargos).
    await tareas_automaticas.sincronizar(sesion)
    consulta = select(Tarea)
    condiciones = []
    if vista in ("mias", "hoy", "vencidas", "semana") and responsable_id is None:
        condiciones.append(Tarea.responsable_id == usuario.id)
    if responsable_id is not None:
        condiciones.append(Tarea.responsable_id == (responsable_id or None))
    # «vencidas» trae hasta este momento; una tarea con fecha sin hora vence al terminar su
    # día, así que se afina al serializar (campo `vencida`).
    _, hasta = reglas.rango_vista(vista, reglas.ahora_utc(), svc.zona())
    if hasta is not None:
        condiciones.append(Tarea.vence_en.is_not(None))
        condiciones.append(Tarea.vence_en <= hasta)
    if vista == "sin_fecha":
        condiciones.append(Tarea.vence_en.is_(None))
    if estado:
        estados = [e for e in estado.split(",") if e in reglas.ESTADOS]
        condiciones.append(Tarea.estado.in_(estados))
    elif vista == "hechas":
        condiciones.append(Tarea.estado.in_(reglas.CERRADOS))
    elif cerradas_dias:
        condiciones.append(or_(Tarea.estado.in_(reglas.ABIERTOS),
                               and_(Tarea.estado == "hecha", Tarea.cerrada_en >= reglas.ahora_utc() - timedelta(days=cerradas_dias))))
    elif not incluir_cerradas:
        condiciones.append(Tarea.estado.in_(reglas.ABIERTOS))
    if lista_id is not None:
        condiciones.append(Tarea.lista_id == (lista_id or None))
    if entidad:
        ids = await svc.origenes_con(sesion, entidad.strip(), "tarea")
        condiciones.append(or_(Tarea.id.in_(ids or [0]), Tarea.entregable == entidad.strip()))
    if etiqueta:
        condiciones.append(Tarea.etiquetas.contains([etiqueta.lower()]))
    if q:
        patron = f"%{q.strip().lower()}%"
        condiciones.append(or_(func.lower(Tarea.titulo).like(patron), func.lower(Tarea.descripcion).like(patron)))
    if condiciones:
        consulta = consulta.where(and_(*condiciones))
    orden = Tarea.cerrada_en.desc() if vista == "hechas" else Tarea.vence_en.asc().nulls_last()
    filas = (await sesion.execute(consulta.order_by(orden, Tarea.orden, Tarea.id).limit(limite))).scalars().all()
    datos = await svc.serializar_tareas(sesion, list(filas))
    if vista == "vencidas":
        datos = [t for t in datos if t["vencida"]]
    if vista != "hechas":
        datos.sort(key=reglas.orden_lista)
    return {"tareas": datos}


@router.get("/resumen")
async def resumen(usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """Lo de la persona para el Inicio: lo vencido, lo de hoy y cuántas tiene abiertas."""
    tz = svc.zona()
    _, fin_hoy = reglas.rango_vista("hoy", reglas.ahora_utc(), tz)
    filas = (await sesion.execute(
        select(Tarea).where(Tarea.responsable_id == usuario.id, Tarea.estado.in_(reglas.ABIERTOS),
                            Tarea.vence_en.is_not(None), Tarea.vence_en <= fin_hoy).order_by(Tarea.vence_en).limit(60)
    )).scalars().all()
    datos = await svc.serializar_tareas(sesion, list(filas))
    abiertas = (await sesion.execute(
        select(func.count()).select_from(Tarea).where(Tarea.responsable_id == usuario.id, Tarea.estado.in_(reglas.ABIERTOS))
    )).scalar_one()
    return {
        "vencidas": [t for t in datos if t["vencida"]],
        "hoy": [t for t in datos if not t["vencida"]],
        "abiertas": abiertas,
    }


@router.get("/opciones")
async def opciones(usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    listas = (await sesion.execute(select(ListaTareas).order_by(ListaTareas.archivada, ListaTareas.nombre))).scalars().all()
    etiquetas = (await sesion.execute(
        select(func.jsonb_array_elements_text(Tarea.etiquetas).label("e")).distinct()
    )).scalars().all()
    return {
        "estados": [{"clave": k, "nombre": v} for k, v in reglas.ETIQUETA_ESTADO.items()],
        "prioridades": [{"clave": k, "nombre": v} for k, v in reglas.ETIQUETA_PRIORIDAD.items()],
        "plantillas": reglas.plantillas_publicas(),
        "usuarios": await svc.usuarios_activos(sesion),
        "listas": [{"id": lst.id, "nombre": lst.nombre, "color": lst.color, "archivada": lst.archivada,
                    "descripcion": lst.descripcion} for lst in listas],
        "etiquetas": sorted(etiquetas)[:200],
        "yo": usuario.id,
        "puede_escribir": usuario.rol != "invitado",
    }


@router.get("/{tid}")
async def ver(tid: int, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    t = await _tarea(sesion, tid)
    datos = (await svc.serializar_tareas(sesion, [t]))[0]
    comentarios = (await sesion.execute(
        select(TareaComentario).where(TareaComentario.tarea_id == tid).order_by(TareaComentario.creado_en, TareaComentario.id)
    )).scalars().all()
    nombres = await svc.nombres_usuarios(sesion, {c.usuario_id for c in comentarios if c.usuario_id})
    datos["comentarios"] = [
        {"id": c.id, "texto": c.texto, "sistema": c.sistema, "usuario_id": c.usuario_id,
         "usuario": nombres.get(c.usuario_id or 0, ""), "creado_en": c.creado_en.isoformat() if c.creado_en else None}
        for c in comentarios
    ]
    return datos


# --- escritura -----------------------------------------------------------------------------


async def _crear(sesion: AsyncSession, datos: TareaEntrada, u: Usuario, origen: str = "qillqa", externo_id: str = "") -> Tarea:
    _validar(datos.estado, datos.prioridad)
    _validar_clase(datos.clase)
    await _responsable_valido(sesion, datos.responsable_id)
    vence, con_hora = _plazo(datos.vence_fecha, datos.vence_hora)
    maximo = (await sesion.execute(select(func.coalesce(func.max(Tarea.orden), 0)).where(Tarea.estado == datos.estado))).scalar_one()
    t = Tarea(
        titulo=datos.titulo.strip(), descripcion=datos.descripcion, estado=datos.estado, prioridad=datos.prioridad,
        importante=datos.importante, responsable_id=datos.responsable_id, vence_en=vence, con_hora=con_hora, lista_id=datos.lista_id or None,
        orden=maximo + 1, etiquetas=reglas.limpiar_etiquetas(datos.etiquetas), checklist=reglas.limpiar_checklist(datos.checklist),
        plantilla=datos.plantilla[:40], clase=datos.clase or "", origen=origen, externo_id=externo_id, creado_por=u.id,
    )
    if datos.estado in reglas.CERRADOS:
        t.cerrada_en, t.cerrada_por = reglas.ahora_utc(), u.id
    sesion.add(t)
    await sesion.flush()
    await svc.poner_vinculos(sesion, f"tarea:{t.id}", datos.vinculos, u.id)
    svc.avisar_asignacion(sesion, t, u)
    await svc.emitir_asignacion(sesion, t, u)
    return t


@router.post("")
async def crear(datos: TareaEntrada, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    _puede_escribir(usuario)
    t = await _crear(sesion, datos, usuario)
    await sesion.commit()
    return (await svc.serializar_tareas(sesion, [t]))[0]


@router.post("/rapida")
async def rapida(datos: RapidaEntrada, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """Alta rápida en lenguaje natural («revisar PL mañana 15:00 @cuenta !alta #comision»).
    Con `vista_previa` solo interpreta (la web lo muestra mientras se escribe). Sin @cuenta,
    la tarea es de quien la escribe (una tarea sin responsable es la que nadie hace)."""
    usuarios = await svc.usuarios_activos(sesion)
    hoy = dia_de_referencia(reglas.ahora_utc().astimezone(svc.zona()).date(), datos.escrito_el)
    r = reglas.interpretar(datos.texto, hoy, [x["usuario"] for x in usuarios])
    por_usuario = {x["usuario"]: x for x in usuarios}
    elegido = por_usuario.get(r["responsable"]) if r["responsable"] else None
    r["responsable_id"] = elegido["id"] if elegido else usuario.id
    r["responsable_nombre"] = elegido["nombre"] if elegido else usuario.nombre_completo
    if datos.vista_previa:
        # Mientras se escribe: si ya hay una parecida, la web la ofrece antes de crear (2026-10-18).
        parecida = await svc.tarea_parecida(sesion, r["titulo"], r["fecha"]) if len(r["titulo"] or "") >= 8 else None
        return {"interpretacion": r, "parecida": parecida}
    _puede_escribir(usuario)
    if not r["titulo"]:
        raise HTTPException(422, "Falta el título de la tarea (lo que hay que hacer).")
    t = await _crear(sesion, TareaEntrada(
        titulo=r["titulo"], prioridad=r["prioridad"] or "normal", responsable_id=r["responsable_id"],
        vence_fecha=r["fecha"], vence_hora=r["hora"], etiquetas=r["etiquetas"], vinculos=datos.vinculos,
        lista_id=datos.lista_id,
    ), usuario)
    await sesion.commit()
    return {"interpretacion": r, "tarea": (await svc.serializar_tareas(sesion, [t]))[0]}


@router.post("/desde-plantilla")
async def desde_plantilla(datos: PlantillaEntrada, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """Una tarea con la lista de verificación de la plantilla (plazo = el último paso) o, con
    `separar`, una LISTA nueva con una tarea por paso y su plazo propio."""
    _puede_escribir(usuario)
    if datos.plantilla not in reglas.PLANTILLAS:
        raise HTTPException(422, "Plantilla desconocida.")
    try:
        referencia = date.fromisoformat(datos.fecha_referencia[:10])
    except ValueError:
        raise HTTPException(422, "La fecha de referencia debe ser AAAA-MM-DD.")
    p = reglas.PLANTILLAS[datos.plantilla]
    titulo = datos.titulo.strip() or f"{p['nombre']} — {referencia.strftime('%d/%m/%Y')}"
    responsable = datos.responsable_id or usuario.id
    pasos = reglas.pasos_con_fecha(datos.plantilla, referencia)
    creadas: list[Tarea] = []
    if datos.separar:
        lista = ListaTareas(nombre=titulo[:120], descripcion=p["descripcion"], creado_por=usuario.id)
        sesion.add(lista)
        await sesion.flush()
        for texto, dia in pasos:
            creadas.append(await _crear(sesion, TareaEntrada(
                titulo=texto, responsable_id=responsable, vence_fecha=dia.isoformat(), lista_id=lista.id,
                vinculos=datos.vinculos, plantilla=datos.plantilla,
            ), usuario))
    else:
        ultimo = max(d for _, d in pasos)
        creadas.append(await _crear(sesion, TareaEntrada(
            titulo=titulo, descripcion=p["descripcion"], responsable_id=responsable, vence_fecha=ultimo.isoformat(),
            checklist=reglas.checklist_de(datos.plantilla), vinculos=datos.vinculos, plantilla=datos.plantilla,
        ), usuario))
    await sesion.commit()
    return {"tareas": await svc.serializar_tareas(sesion, creadas)}


# --- pegar un plan de tareas (2026-10-12; servicios/pegado, bloque `plan-de-tareas`) -----------
# La vista previa: cada tarea lista para `POST /api/tareas`, con el responsable casado con el
# equipo, la lista casada por nombre (o la que habría que crear) y la que ya existe con el mismo
# título y vencimiento marcada para no duplicarla. No escribe nada: la web crea por `POST` y
# deja la constancia en `pegados` (`POST /api/pegar/registrar`).


class PegarTareas(BaseModel):
    texto: str = Field(min_length=1, max_length=60000)
    vinculos: list[str] = []     # p. ej. ['doc:12'] cuando se pega desde un documento


class ParecidaEntrada(BaseModel):
    titulo: str = Field(min_length=1, max_length=1000)
    vence_fecha: str | None = None
    excluir_id: int | None = None


@router.post("/parecida")
async def parecida(datos: ParecidaEntrada, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """¿Ya hay una tarea parecida? (2026-10-18) La ficha lo pregunta antes de crear; el mismo
    criterio que el alta rápida, el pegado del prompt y el chat (`servicios/tareas.py::tarea_parecida`)."""
    return {"parecida": await svc.tarea_parecida(sesion, datos.titulo, datos.vence_fecha, datos.excluir_id)}


@router.post("/pegar")
async def pegar(datos: PegarTareas, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """El resultado del prompt de plan de tareas pegado (bloque `plan-de-tareas`) → vista previa
    de cada tarea (ver el comentario de arriba). 422 si el texto no es ese formato."""
    svc_pegado = opcional("pegado.v1")
    if svc_pegado is None:
        raise HTTPException(503, "Leer lo pegado no está disponible aquí.")
    _puede_escribir(usuario)
    le = svc_pegado.interpretar(datos.texto, ("plan-de-tareas",))
    if not le.valido:
        raise HTTPException(422, {"codigo": "pegado_invalido", "errores": le.errores, "avisos": le.avisos,
                                  "formatos": [f for f in svc_pegado.formatos() if f["tipo"] == "plan-de-tareas"]})
    usuarios = await svc.usuarios_activos(sesion)
    listas = (await sesion.execute(select(ListaTareas).where(ListaTareas.archivada.is_(False)))).scalars().all()
    por_lista = {reglas.normalizar(lst.nombre).strip(): lst for lst in listas}
    comunes = [v.strip() for v in datos.vinculos if reglas.vinculo_valido(v)]
    filas = []
    for i, t in enumerate(le.valores.get("tareas") or [], 1):
        avisos: list[str] = []
        nombre = (t.get("responsable") or "").strip()
        elegido = reglas.casar_responsable(nombre, usuarios) if nombre else None
        vence = t.get("vence") or None
        hora = t.get("hora") if vence else None
        if t.get("hora") and not vence:
            avisos.append("Trae hora sin fecha: queda sin plazo.")
        lista_id, lista_nueva = None, ""
        if t.get("lista"):
            lst = por_lista.get(reglas.normalizar(t["lista"]).strip())
            if lst:
                lista_id = lst.id
            else:
                lista_nueva = t["lista"].strip()[:120]
        vinculos, descartados = [], []
        for v in t.get("vinculo") or []:
            limpio = re.sub(r"\s+", "", v).lower()
            if reglas.vinculo_valido(limpio):
                if limpio not in vinculos:
                    vinculos.append(limpio)
            else:
                descartados.append(v)
        for v in comunes:
            if v not in vinculos:
                vinculos.append(v)
        if descartados:
            avisos.append(f"Vínculo no reconocido, se omite: {', '.join(descartados)[:120]}.")
        tarea = {
            "titulo": t["titulo"][:1000], "descripcion": t.get("descripcion") or "", "estado": "por_hacer",
            "prioridad": t.get("prioridad") or "normal", "importante": False,
            "responsable_id": elegido["id"] if elegido else None, "vence_fecha": vence, "vence_hora": hora,
            "lista_id": lista_id, "etiquetas": reglas.limpiar_etiquetas(t.get("etiquetas")),
            "checklist": reglas.limpiar_checklist([{"texto": p} for p in t.get("pasos") or []]), "vinculos": vinculos,
        }
        existente = await svc.tarea_parecida(sesion, tarea["titulo"], vence)
        filas.append({
            "n": i, "tarea": tarea, "responsable_texto": nombre, "responsable_nombre": elegido["nombre"] if elegido else "",
            # El bloque nombra a alguien que no casa con UNA sola persona del equipo: la web pide elegir.
            "responsable_sin_casar": bool(nombre and not elegido),
            "lista_nueva": lista_nueva, "existente": existente, "avisos": avisos,
            "dudas": {k.split(".", 1)[1]: d for k, d in le.dudas.items() if k.startswith(f"tareas[{i}].")},
            "estado": "existente" if existente else "nuevo",
        })
    return {"lectura": le.como_dict(), "tareas": filas, "observaciones": le.valores.get("observaciones") or [], "resto": le.resto}


@router.patch("/{tid}")
async def cambiar(tid: int, datos: TareaCambio, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    """Cambio parcial: solo viaja lo que cambia. Mover en el tablero = `estado` + `orden`."""
    _puede_escribir(usuario)
    t = await _tarea(sesion, tid)
    if datos.version is not None and datos.version != t.version:
        raise HTTPException(409, {"codigo": "tarea_modificada", "mensaje": "Otra persona cambió esta tarea: se recargó la versión vigente."})
    _validar(datos.estado, datos.prioridad)
    if datos.titulo is not None:
        t.titulo = datos.titulo.strip()
    if datos.descripcion is not None:
        t.descripcion = datos.descripcion
    if datos.prioridad is not None and datos.prioridad != t.prioridad:
        t.prioridad = datos.prioridad
    if datos.importante is not None:
        t.importante = datos.importante
    if datos.quitar_responsable:
        if t.responsable_id:
            _bitacora(sesion, t, usuario, "Quedó sin responsable")
        t.responsable_id = None
    elif datos.responsable_id is not None and datos.responsable_id != t.responsable_id:
        await _responsable_valido(sesion, datos.responsable_id)
        t.responsable_id = datos.responsable_id
        nombre = (await svc.nombres_usuarios(sesion, {datos.responsable_id})).get(datos.responsable_id, "")
        _bitacora(sesion, t, usuario, f"Responsable: {nombre}")
        svc.avisar_asignacion(sesion, t, usuario)
        await svc.emitir_asignacion(sesion, t, usuario)
    if datos.quitar_plazo:
        t.vence_en, t.con_hora = None, False
    elif datos.vence_fecha is not None:
        t.vence_en, t.con_hora = _plazo(datos.vence_fecha, datos.vence_hora)
    if datos.quitar_lista:
        t.lista_id = None
    elif datos.lista_id is not None:
        t.lista_id = datos.lista_id
    if datos.etiquetas is not None:
        t.etiquetas = reglas.limpiar_etiquetas(datos.etiquetas)
    if datos.checklist is not None:
        t.checklist = reglas.limpiar_checklist(datos.checklist)
    if datos.entregable is not None:
        entregable = datos.entregable.strip()[:300]
        if entregable and not (reglas.vinculo_valido(entregable) or entregable.startswith(("http://", "https://"))):
            raise HTTPException(422, "El entregable es un documento del sistema (doc:12) o un enlace http(s).")
        t.entregable = entregable
    if datos.clase is not None:
        _validar_clase(datos.clase)
        t.clase = datos.clase
    if datos.estado is not None:
        _cambiar_estado(sesion, t, datos.estado, usuario)
    if datos.orden is not None:
        t.orden = datos.orden
    if datos.vinculos is not None:
        await svc.poner_vinculos(sesion, f"tarea:{t.id}", datos.vinculos, usuario.id)
    t.version += 1
    await sesion.commit()
    await svc.propagar(f"tarea:{t.id}")  # los mensajes del chat sobre la tarea, al día (2026-10-18)
    await sesion.refresh(t)
    return (await svc.serializar_tareas(sesion, [t]))[0]


@router.post("/{tid}/comentarios")
async def comentar(tid: int, datos: ComentarioEntrada, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    _puede_escribir(usuario)
    t = await _tarea(sesion, tid)
    sesion.add(TareaComentario(tarea_id=t.id, usuario_id=usuario.id, texto=datos.texto.strip()))
    from minka import eventos as salida

    for destinatario in {t.responsable_id, t.creado_por}:
        salida.avisar(sesion, destinatario, f"{usuario.nombre_completo} comentó «{t.titulo[:120]}»: {datos.texto[:200]}",
                     "tarea", evitar=usuario.id, destino=f"tarea:{t.id}")
    await sesion.commit()
    return {"ok": True}


@router.delete("/{tid}")
async def eliminar(tid: int, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    _puede_escribir(usuario)
    t = await _tarea(sesion, tid)
    if t.creado_por != usuario.id and usuario.rol != "administrador":
        raise HTTPException(403, "Solo quien creó la tarea (o el administrador) puede eliminarla; puede cancelarla.")
    await svc.quitar_vinculos(sesion, f"tarea:{t.id}")
    await sesion.delete(t)
    await sesion.commit()
    return {"ok": True}


# --- listas --------------------------------------------------------------------------------


@router.post("/listas")
async def crear_lista(datos: ListaEntrada, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    _puede_escribir(usuario)
    lst = ListaTareas(nombre=datos.nombre.strip(), descripcion=datos.descripcion, color=datos.color[:20], creado_por=usuario.id)
    sesion.add(lst)
    await sesion.commit()
    return {"id": lst.id, "nombre": lst.nombre, "color": lst.color, "archivada": lst.archivada, "descripcion": lst.descripcion}


@router.patch("/listas/{lid}")
async def cambiar_lista(lid: int, datos: ListaEntrada, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_minka)) -> dict:
    _puede_escribir(usuario)
    lst = await sesion.get(ListaTareas, lid)
    if lst is None:
        raise HTTPException(404, "La lista no existe.")
    lst.nombre, lst.descripcion, lst.color, lst.archivada = datos.nombre.strip(), datos.descripcion, datos.color[:20], datos.archivada
    await sesion.commit()
    return {"id": lst.id, "nombre": lst.nombre, "color": lst.color, "archivada": lst.archivada, "descripcion": lst.descripcion}


# --- Super Productivity --------------------------------------------------------------------


@router.post("/importar/superproductivity")
async def importar_sp(
    archivo: UploadFile = File(...),
    aplicar: bool = False,
    incluir_hechas: bool = False,
    incluir_archivo: bool = False,
    usuario: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_minka),
) -> dict:
    """Respaldo JSON de Super Productivity → tareas de Qillqa. SIMULA por omisión (vista
    previa: qué se crearía y qué ya estaba); escribe solo con `aplicar=true`. Idempotente: lo
    ya importado (mismo `externo_id`) no se duplica. Las tareas quedan a cargo de quien importa."""
    _puede_escribir(usuario)
    crudo = await archivo.read()
    if len(crudo) > 30 * 1024 * 1024:
        raise HTTPException(413, "El respaldo pasa de 30 MB.")
    try:
        datos = json.loads(crudo.decode("utf-8-sig"))
        p = sp.plan(datos, svc.zona(), incluir_hechas=incluir_hechas, incluir_archivo=incluir_archivo)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(422, "El archivo no es JSON. Exporte con «Exportar datos» en Super Productivity.")
    except sp.FormatoNoReconocido as e:
        raise HTTPException(422, str(e))
    ya_tareas = set((await sesion.execute(
        select(Tarea.externo_id).where(Tarea.externo_id.in_([t["externo_id"] for t in p["tareas"]] or ["-"]))
    )).scalars().all())
    ya_listas = {lst.externo_id: lst for lst in (await sesion.execute(
        select(ListaTareas).where(ListaTareas.externo_id.in_([x["externo_id"] for x in p["listas"]] or ["-"]))
    )).scalars().all()}
    nuevas = [t for t in p["tareas"] if t["externo_id"] not in ya_tareas]
    listas_nuevas = [x for x in p["listas"] if x["externo_id"] not in ya_listas]
    resumen = {
        "aplicado": False,
        "tareas_nuevas": len(nuevas),
        "tareas_ya_importadas": len(p["tareas"]) - len(nuevas),
        "listas_nuevas": [x["nombre"] for x in listas_nuevas],
        "omitidas": p["omitidas"],
        "avisos": p["avisos"],
        "muestra": [
            {"titulo": t["titulo"], "vence": t["vence_en"].isoformat() if t["vence_en"] else None, "estado": t["estado"],
             "etiquetas": t["etiquetas"], "puntos": len(t["checklist"])}
            for t in nuevas[:25]
        ],
    }
    if not aplicar:
        return resumen
    for x in listas_nuevas:
        lst = ListaTareas(nombre=x["nombre"], color=x["color"], externo_id=x["externo_id"], creado_por=usuario.id)
        sesion.add(lst)
        await sesion.flush()
        ya_listas[x["externo_id"]] = lst
    for i, t in enumerate(nuevas):
        lst = ya_listas.get(t["lista_externo_id"]) if t["lista_externo_id"] else None
        sesion.add(Tarea(
            titulo=t["titulo"], descripcion=t["descripcion"], estado=t["estado"], prioridad="normal",
            responsable_id=usuario.id, vence_en=t["vence_en"], con_hora=t["con_hora"], lista_id=lst.id if lst else None,
            orden=i, etiquetas=t["etiquetas"], checklist=t["checklist"], origen="superproductivity",
            externo_id=t["externo_id"], creado_por=usuario.id,
            cerrada_en=reglas.ahora_utc() if t["estado"] == "hecha" else None,
            cerrada_por=usuario.id if t["estado"] == "hecha" else None,
        ))
    await sesion.commit()
    resumen["aplicado"] = True
    return resumen
