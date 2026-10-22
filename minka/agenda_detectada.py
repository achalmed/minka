"""Agenda detectada en los documentos (2026-10-08, Edison: «en el oficio 127 solicito un local para
la reunión de este sábado, con hora incluso; el sistema ya debió identificar y agendar esa reunión»).

Al guardar un documento se buscan en su asunto y su cuerpo frases que anuncian un evento (reunión,
sesión, mesa técnica, visita, audiencia…) con una fecha («sábado 10 de octubre de 2026», «el 15 de
noviembre», «15/11/2026», «este sábado») y, si la hay, una hora («a las 12:00 m.», «a las 3 p. m.»,
«de 9:00 a 11:00 horas»). Cada una se agenda como evento PROPUESTO (por confirmar), vinculado al
documento, con `origen='detectado'` y `externo_id='doc:<id>:<fecha>T<hora>'`:

- si el documento cambia y la fecha ya no está, el propuesto que nadie tocó se retira;
- si alguien borra un evento detectado, su `externo_id` queda en el ajuste `agenda_descartados` y
  no vuelve a crearse;
- confirmado, editado o cancelado por una persona, ya no se toca.

`detectar` es pura (texto + fecha del documento → eventos), probada en tests/test_agenda_detectada.py.
"""

import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

log = logging.getLogger("qillqa.agenda_detectada")

ZONA = ZoneInfo("America/Lima")
MESES = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
         "setiembre": 9, "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}
DIAS = {"lunes": 0, "martes": 1, "miercoles": 2, "jueves": 3, "viernes": 4, "sabado": 5, "domingo": 6}
HORIZONTE = 180  # días hacia adelante desde la fecha del documento

# Lo que anuncia un evento. El primer grupo es el nombre que lleva el evento propuesto.
_EVENTO = re.compile(
    r"\b(reunion(?: de trabajo| tecnica| informativa| de coordinacion)?|sesion(?: ordinaria| extraordinaria| descentralizada)?|"
    r"mesa (?:tecnica|de trabajo|de dialogo)|audiencia(?: publica)?|visita(?: de trabajo| de inspeccion)?|inspeccion|"
    r"asamblea|taller|conversatorio|foro|ceremonia|inauguracion|juramentacion|conferencia(?: de prensa)?|capacitacion|"
    r"exposicion|entrevista|encuentro|jornada|citacion|convocatoria|evento|acto(?: publico| protocolar)?|desfile)\b"
)
_FECHA = re.compile(
    r"(?:\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s*,?\s*)?"
    r"\b(\d{1,2})\s+de\s+(" + "|".join(MESES) + r")(?:\s+(?:de|del)\s+(\d{4}))?\b"
)
_FECHA_NUM = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b")
_RELATIVA = re.compile(r"\b(?:este|esta|el proximo|la proxima|proximo)\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b")
_HORA = re.compile(
    r"\b(?:a\s+las?|desde\s+las?|de|las)\s+(\d{1,2})(?!\d)(?:[:.](\d{2}))?\s*"
    r"(?:(?:horas|hrs?\.?|h)\b\s*)?(a\.?\s?m\.?|p\.?\s?m\.?|m\.|del?\s+(?:la\s+)?(?:manana|tarde|noche|mediodia))?"
    r"(?:\s*(?:a|hasta)\s+(?:las?\s+)?(\d{1,2})(?!\d)(?:[:.](\d{2}))?\s*(?:(?:horas|hrs?\.?|h)\b\s*)?(a\.?\s?m\.?|p\.?\s?m\.?|m\.)?)?"
)


def _sin_tildes(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t.lower()) if unicodedata.category(c) != "Mn")


def _hora(h: str, m: str | None, sufijo: str | None) -> time | None:
    hh, mm = int(h), int(m or 0)
    s = (sufijo or "").replace(" ", "").replace(".", "")
    if s in ("pm", "delatarde", "delanoche", "tarde", "noche") or "tarde" in s or "noche" in s:
        hh = hh + 12 if hh < 12 else hh
    elif s in ("am",) or "manana" in s:
        hh = 0 if hh == 12 else hh
    elif s == "m" or "mediodia" in s:
        hh = 12
    elif hh < 7:  # «a las 3» en un oficio es por la tarde
        hh += 12
    return time(hh, mm) if 0 <= hh < 24 and 0 <= mm < 60 else None


def _es_hora(m: re.Match) -> bool:
    """«a las 3», «desde las 9»: hora. «de 2» solo si trae minutos, a. m./p. m. o un rango
    («de 9:00 a 11:00»): si no, es «de 2 representantes»."""
    if m.group(0).startswith(("a ", "desde ", "las ")):
        return True
    return bool(m.group(2) or m.group(3) or m.group(4))


@dataclass
class Detectado:
    fecha: date
    hora: time | None
    hora_fin: time | None
    nombre: str
    frase: str

    @property
    def clave(self) -> str:
        return f"{self.fecha.isoformat()}T{self.hora.strftime('%H:%M') if self.hora else 'dia'}"


def _frases(texto: str) -> list[str]:
    salida = []
    for parrafo in texto.splitlines():
        # Corta en «. » + mayúscula, sin cortar en «a. m.», «p. m.», «m.», «N.°», «Sr.».
        salida += [f.strip() for f in re.split(r"(?<![apmNS]\.)(?<!\bm\.)(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])", parrafo) if f.strip()]
    return salida


def detectar(texto: str, referencia: date) -> list[Detectado]:
    """Eventos con fecha anunciados en el texto, a partir de `referencia` (la fecha del documento)
    y hasta HORIZONTE días después. Pura."""
    salida: dict[str, Detectado] = {}
    for frase in _frases(texto):
        f = _sin_tildes(frase)
        evento = _EVENTO.search(f)
        if not evento:
            continue
        fechas: list[tuple[int, date]] = []
        for m in _FECHA.finditer(f):
            dia, mes, anio = int(m.group(2)), MESES[m.group(3)], int(m.group(4)) if m.group(4) else referencia.year
            try:
                d = date(anio, mes, dia)
            except ValueError:
                continue
            if not m.group(4) and d < referencia - timedelta(days=1):
                try:
                    d = date(anio + 1, mes, dia)
                except ValueError:
                    continue
            fechas.append((m.end(), d))
        for m in _FECHA_NUM.finditer(f):
            try:
                fechas.append((m.end(), date(int(m.group(3)), int(m.group(2)), int(m.group(1)))))
            except ValueError:
                continue
        for m in _RELATIVA.finditer(f):
            objetivo = DIAS[m.group(1)]
            delta = (objetivo - referencia.weekday()) % 7 or 7
            fechas.append((m.end(), referencia + timedelta(days=delta)))
        for fin_fecha, d in fechas:
            if not (referencia <= d <= referencia + timedelta(days=HORIZONTE)):
                continue
            # La hora: la primera que sigue a la fecha (o, si no hay, la de la frase).
            h = next((x for x in list(_HORA.finditer(f, fin_fecha)) + list(_HORA.finditer(f)) if _es_hora(x)), None)
            hora = _hora(h.group(1), h.group(2), h.group(3)) if h else None
            hora_fin = _hora(h.group(4), h.group(5), h.group(6) or h.group(3)) if h and h.group(4) else None
            if hora and hora_fin and hora_fin <= hora:
                hora_fin = None
            nombre = evento.group(1)
            # Las tildes del original y en minúsculas («AUDIENCIA» → «Audiencia»).
            original = frase[evento.start(1):evento.end(1)].lower()
            nombre = original if _sin_tildes(original) == nombre else nombre
            det = Detectado(d, hora, hora_fin, nombre[:1].upper() + nombre[1:], frase[:500])
            salida.setdefault(det.clave, det)
    # El mismo día con y sin hora (el asunto lo anuncia sin hora; el cuerpo, con ella): queda
    # el que tiene hora.
    con_hora = {d.fecha for d in salida.values() if d.hora}
    return [d for d in salida.values() if d.hora or d.fecha not in con_hora]


# --- La agenda -------------------------------------------------------------------------------

CLAVE_DESCARTADOS = "agenda_descartados"


def tipo_de(frase: str) -> str:
    f = _sin_tildes(frase)
    if "pleno" in f:
        return "pleno"
    if "comision" in f:
        return "comision"
    if re.search(r"\b(?:en el|en este|en nuestro) despacho\b", f):
        return "despacho"
    return "externa"


async def _ya_agendado(sesion, d: Detectado) -> bool:
    """¿Hay ya en la agenda un evento de una persona ese día (y, con hora, a menos de una hora)?"""
    from sqlalchemy import and_, select

    from minka.modelos import EventoAgenda

    desde = datetime.combine(d.fecha, time(0, 0), ZONA)
    hasta = desde + timedelta(days=1)
    filas = (await sesion.execute(select(EventoAgenda).where(and_(
        EventoAgenda.inicio >= desde, EventoAgenda.inicio < hasta, EventoAgenda.origen != "detectado",
        EventoAgenda.estado.notin_(("cancelado",)),
    )))).scalars().all()
    if not d.hora:
        return bool(filas)
    objetivo = datetime.combine(d.fecha, d.hora, ZONA)
    return any(not e.todo_el_dia and abs((e.inicio - objetivo).total_seconds()) < 3600 for e in filas)


# --- Lo vinculado se muestra vigente (2026-10-12, Edison: «todo está vinculado y nada está suelto») ---
#
# El título de un evento detectado lleva la etiqueta del documento entre paréntesis («Visita de
# trabajo (OF-0128)»): es una COPIA que se recompone cuando el documento cambia (número, asunto,
# fecha) y al reconciliar. La parte que escribió una persona (el nombre) no se toca; si quitó el
# paréntesis, tampoco. Los cambios del sistema no suben `version` (esa marca dice «lo tocó una persona»).

_PARENTESIS = re.compile(r"^(.*\S)\s*\(([^()]*)\)\s*$", re.S)
_ETIQUETA_DOC = re.compile(r"S/N|N\.?\s?°|^[A-ZÑ]{1,10}-\d{1,5}$")
_DETECTADO_EN = re.compile(r"^Detectado en (.+?): «", re.M)
_LINEA_ASUNTO = re.compile(r"^Asunto: .*$", re.M)


def etiqueta_corta(serie: str, numero: int | None, mostrado: str) -> str:
    """«OF-0128» si tiene número; si no, el número mostrado del borrador («Oficio S/N-…»). Pura."""
    return f"{serie}-{numero:04d}" if serie and numero else mostrado


def es_etiqueta_documento(texto: str) -> bool:
    """¿Lo que va entre paréntesis es la etiqueta de un documento («OF-0128», «Oficio S/N-…»,
    «Oficio N°0131-…»)? Pura."""
    return bool(_ETIQUETA_DOC.search((texto or "").strip()))


def titulo_detectado(nombre: str, etiqueta: str) -> str:
    return f"{nombre} ({etiqueta})"[:300] if etiqueta else nombre[:300]


def recomponer_titulo(titulo: str, etiqueta: str) -> str:
    """El título con la etiqueta VIGENTE del documento en su paréntesis final; si el título no
    termina en la etiqueta de un documento (una persona lo reescribió), queda igual. Pura."""
    m = _PARENTESIS.match(titulo or "")
    if not m or not etiqueta or not es_etiqueta_documento(m.group(2)):
        return titulo
    return titulo_detectado(m.group(1), etiqueta)


def recomponer_descripcion(descripcion: str, etiqueta: str, asunto: str | None = None) -> str:
    """«Detectado en <etiqueta vigente>: «…»» y, si se pasa `asunto` (evento que nadie tocó), la
    línea «Asunto: …» con el vigente. Pura."""
    d = descripcion or ""
    if etiqueta:
        d = _DETECTADO_EN.sub(lambda m: f"Detectado en {etiqueta}: «", d, count=1)
    if asunto is not None:
        d = _LINEA_ASUNTO.sub(lambda m: f"Asunto: {asunto}", d, count=1)
    return d


def origen_de(externo_id: str) -> str:
    """`doc:12:2026-10-16T09:00` → `doc:12`. Pura."""
    partes = (externo_id or "").split(":")
    return ":".join(partes[:2]) if len(partes) >= 3 else ""


def clave_de(externo_id: str) -> str:
    """`doc:12:2026-10-16T09:00` → `2026-10-16T09:00`. Pura."""
    partes = (externo_id or "").split(":", 2)
    return partes[2] if len(partes) == 3 else ""


def normalizar_nombre(nombre: str) -> str:
    return re.sub(r"\s+", " ", _sin_tildes(_PARENTESIS.sub(r"\1", nombre or ""))).strip()


def plan_fusion(filas: list[dict]) -> list[tuple[int, list[int]]]:
    """Qué eventos detectados son la MISMA actividad y en cuál se juntan. Cada fila:
    {id, origen ('doc:12'), vivo (el documento existe), clave ('2026-10-16T09:00' o '…Tdia'),
    nombre (sin el paréntesis), tocado (lo confirmó o editó una persona), participantes}.

    Son la misma: (1) del mismo origen y el mismo día; (2) de un origen que ya no existe y otro
    evento del mismo día, hora y nombre (el oficio se rehízo: el viernes salía dos veces);
    (3) de dos documentos vivos con el mismo día, HORA y nombre (dos invitaciones a la misma
    reunión). Queda el que una persona trabajó (tocado, con participantes), luego el más viejo.
    Devuelve [(queda, [absorbidos])]. Pura."""
    padre = {f["id"]: f["id"] for f in filas}

    def raiz(i: int) -> int:
        while padre[i] != i:
            padre[i] = padre[padre[i]]
            i = padre[i]
        return i

    def unir(a: int, b: int) -> None:
        ra, rb = raiz(a), raiz(b)
        if ra != rb:
            padre[max(ra, rb)] = min(ra, rb)

    por_dia: dict[tuple, int] = {}
    por_actividad: dict[tuple, list[dict]] = {}
    for f in filas:
        dia = f["clave"][:10]
        k = (f["origen"], dia)
        if k in por_dia:
            unir(por_dia[k], f["id"])
        else:
            por_dia[k] = f["id"]
        por_actividad.setdefault((f["clave"], normalizar_nombre(f["nombre"])), []).append(f)
    for (clave, _), grupo in por_actividad.items():
        if len(grupo) < 2:
            continue
        con_hora = not clave.endswith("Tdia")
        for a in grupo:
            for b in grupo:
                if a["id"] < b["id"] and a["origen"] != b["origen"] and (con_hora or not (a["vivo"] and b["vivo"])):
                    unir(a["id"], b["id"])
    grupos: dict[int, list[dict]] = {}
    for f in filas:
        grupos.setdefault(raiz(f["id"]), []).append(f)
    salida = []
    for grupo in grupos.values():
        if len(grupo) < 2:
            continue
        orden = sorted(grupo, key=lambda f: (not f["tocado"], -f["participantes"], not f["vivo"], f["id"]))
        salida.append((orden[0]["id"], sorted(f["id"] for f in orden[1:])))
    return sorted(salida)


def _tocado(e) -> bool:
    return e.estado != "propuesto" or (e.version or 1) > 1


def _dia_local(e) -> str:
    return e.inicio.astimezone(ZONA).date().isoformat()


async def _vinculados(sesion, origen: str) -> list:
    """Eventos detectados de un documento o recibido: los suyos (`externo_id` = `<origen>:…`) y
    los de otro origen a los que quedó vinculado (la misma actividad, fusionada)."""
    from sqlalchemy import or_, select

    from minka.modelos import EventoAgenda, VinculoMinka

    ids = [int(o.split(":", 1)[1]) for o in (await sesion.execute(
        select(VinculoMinka.origen).where(VinculoMinka.destino == origen, VinculoMinka.origen.like("evento:%"))
    )).scalars().all() if o.split(":", 1)[1].isdigit()]
    condicion = EventoAgenda.externo_id.like(f"{origen}:%")
    if ids:
        condicion = or_(condicion, EventoAgenda.id.in_(ids))
    return list((await sesion.execute(
        select(EventoAgenda).where(EventoAgenda.origen == "detectado", condicion)
    )).scalars().all())


async def _actividad_de_otro(sesion, origen: str, d: "Detectado"):
    """Un evento detectado VIVO de otro documento con el mismo día, hora y nombre: la misma
    actividad (dos invitaciones a la misma reunión). Se vincula en vez de duplicarse."""
    from sqlalchemy import select

    from minka.modelos import EventoAgenda

    if not d.hora:
        return None
    for e in (await sesion.execute(select(EventoAgenda).where(
        EventoAgenda.origen == "detectado", EventoAgenda.externo_id.like(f"%:{d.clave}"),
        EventoAgenda.estado != "cancelado",
    ))).scalars().all():
        if origen_de(e.externo_id) != origen and normalizar_nombre(e.titulo) == normalizar_nombre(d.nombre):
            return e
    return None


def recomponer_evento(e, etiqueta: str, asunto: str | None, lugar: str | None) -> bool:
    """Pone en el evento la etiqueta vigente del documento (título, descripción) y, si nadie lo
    tocó, el asunto y el lugar vigentes. Devuelve si cambió algo. No sube `version`."""
    titulo = recomponer_titulo(e.titulo, etiqueta)
    intacto = not _tocado(e)
    descripcion = recomponer_descripcion(e.descripcion, etiqueta, asunto if intacto else None)
    cambio = False
    if titulo != e.titulo:
        e.titulo, cambio = titulo, True
    if descripcion != e.descripcion:
        e.descripcion, cambio = descripcion, True
    if intacto and lugar is not None and (lugar or "")[:300] != (e.lugar or ""):
        e.lugar, cambio = (lugar or "")[:300], True
    return cambio


def _etiquetas_doc(ficha: dict) -> tuple[str, str]:
    """(número mostrado, etiqueta corta) de la ficha de un documento (documentos_contrato.ficha_documento)."""
    numero = ficha["mostrado"]
    return numero, etiqueta_corta(ficha["serie"], ficha["numero"], numero)


async def _descartados(sesion) -> set[str]:
    from minka.modelos import AjusteMinka

    fila = await sesion.get(AjusteMinka, CLAVE_DESCARTADOS)
    return set((fila.valor or {}).get("ids", [])) if fila else set()


async def recomponer_de_documento(sesion, ficha: dict) -> int:
    """Los eventos detectados del documento (su `ficha`) con su etiqueta vigente (número, asunto, lugar). Sin
    commit. Lo llaman la sincronización al guardar/generar, los eventos del sistema del documento
    (numerado, estado) y la reconciliación. Devuelve cuántos cambió."""
    _, corto = _etiquetas_doc(ficha)
    origen = f"doc:{ficha['id']}"
    n = 0
    for e in await _vinculados(sesion, origen):
        if origen_de(e.externo_id) != origen:
            continue  # fusionado con otro documento: lleva la etiqueta de aquel
        if recomponer_evento(e, corto, ficha["asunto_campo"], ficha["destinatario_institucion"]):
            n += 1
    return n


async def sincronizar_documento(sesion, ficha: dict, usuario) -> int:
    """Agenda como «propuesto» lo que el documento anuncia, retira los propuestos que ya no
    anuncia y pone en los que quedan la etiqueta vigente del documento. Una actividad por
    documento y día: si cambia la hora en el texto, el propuesto se mueve (no se duplica); si
    una persona ya lo tocó, manda lo suyo. Devuelve cuántos eventos nuevos propuso. Sin commit: lo da quien llama
    (Qillqa, con lo demás del guardado). `ficha`: la del documento (documentos_contrato.ficha_documento)."""
    from minka.modelos import EventoAgenda
    from minka import tareas_automaticas
    from minka.tareas import poner_vinculos, vinculos_de

    try:
        referencia = date.fromisoformat(ficha["fecha_campo"][:10])
    except ValueError:
        referencia = date.today()
    detectados = {d.clave: d for d in detectar(ficha["texto"], referencia)}
    origen = f"doc:{ficha['id']}"
    prefijo = f"{origen}:"
    vinculados = await _vinculados(sesion, origen)
    propios = {e.externo_id: e for e in vinculados if e.externo_id.startswith(prefijo)}
    por_dia = {}
    for e in vinculados:
        por_dia.setdefault(_dia_local(e), e)
    descartados = await _descartados(sesion)
    numero, corto = _etiquetas_doc(ficha)
    nuevos = 0
    hoy = datetime.now(ZONA).date()
    vigentes: set[str] = set()
    dias: set[date] = set()
    for clave, d in detectados.items():
        # Una actividad por documento y día: el asunto y el cuerpo pueden anunciarla con horas
        # distintas («a las 9», «a las 9:30»); vale la primera.
        if d.fecha in dias:
            continue
        dias.add(d.fecha)
        externo = prefijo + clave
        inicio = datetime.combine(d.fecha, d.hora or time(0, 0), ZONA)
        if d.hora:
            fin = datetime.combine(d.fecha, d.hora_fin, ZONA) if d.hora_fin else inicio + timedelta(hours=1)
        else:
            fin = inicio
        ya = propios.get(externo) or por_dia.get(d.fecha.isoformat())
        if ya is not None:
            vigentes.add(ya.externo_id)
            # La misma actividad, otra hora en el texto: el propuesto que nadie tocó se mueve.
            if ya.externo_id != externo and ya.externo_id.startswith(prefijo) and not _tocado(ya):
                ya.externo_id, ya.inicio, ya.fin, ya.todo_el_dia = externo, inicio, fin, d.hora is None
                vigentes.add(externo)
            continue
        # Lo que ya pasó no se propone (un documento viejo editado), ni lo ya agendado a mano a
        # esa hora (o ese día, si no hay hora).
        if externo in descartados or d.fecha < hoy:
            continue
        otro = await _actividad_de_otro(sesion, origen, d)
        if otro is not None:
            actuales = (await vinculos_de(sesion, [f"evento:{otro.id}"])).get(f"evento:{otro.id}", [])
            await poner_vinculos(sesion, f"evento:{otro.id}", actuales + [origen], usuario.id if usuario else None)
            por_dia[d.fecha.isoformat()] = otro
            continue
        if await _ya_agendado(sesion, d):
            continue
        e = EventoAgenda(
            titulo=titulo_detectado(d.nombre, corto),
            descripcion=f"Detectado en {corto}: «{d.frase}»\nAsunto: {ficha['asunto_campo']}\nRevíselo y confírmelo o bórrelo.",
            tipo=tipo_de(d.frase), estado="propuesto", inicio=inicio, fin=fin, todo_el_dia=d.hora is None,
            lugar=ficha["destinatario_institucion"][:300], origen="detectado", externo_id=externo,
            creado_por=usuario.id if usuario else None, excepciones=[],
        )
        sesion.add(e)
        await sesion.flush()
        await poner_vinculos(sesion, f"evento:{e.id}", [origen], usuario.id if usuario else None)
        por_dia[d.fecha.isoformat()] = e
        vigentes.add(externo)
        nuevos += 1
    # Lo que el documento ya no anuncia: se retira solo si sigue propuesto (nadie lo tocó).
    for externo, e in propios.items():
        if externo not in vigentes and not _tocado(e):
            await _retirar(sesion, e, origen)
    # Lo vinculado al documento con su etiqueta vigente (estos eventos y sus tareas automáticas). Los mensajes del chat
    # que lo muestran los pone al día quien llama (Qillqa).
    await sesion.flush()
    await recomponer_de_documento(sesion, ficha)
    await tareas_automaticas.recomponer_de_documento(sesion, ficha)
    if nuevos:
        log.info("Documento %s: %d evento(s) propuesto(s) en la agenda.", ficha["id"], nuevos)
    return nuevos


async def _retirar(sesion, e, origen: str) -> None:
    """Retira un propuesto de `origen`. Si otro documento vivo también lo anuncia (actividad
    fusionada), pasa a ser de ese y solo se quita el vínculo con `origen`."""
    from sqlalchemy import delete

    from tiqsi.modulo import opcional

    from minka.modelos import VinculoMinka
    from minka.tareas import quitar_vinculos, vinculos_de

    otros = [v for v in (await vinculos_de(sesion, [f"evento:{e.id}"])).get(f"evento:{e.id}", [])
             if v != origen and v.startswith("doc:") and v[4:].isdigit()]
    docs = opcional("documentos.v1")   # cuáles siguen vivos (sin Gestión documental, ninguno hereda)
    vivos = set(await docs.fichas([int(v[4:]) for v in otros])) if otros and docs is not None else set()
    heredero = next((v for v in otros if int(v[4:]) in vivos), None)
    if heredero:
        e.externo_id = f"{heredero}:{clave_de(e.externo_id)}"
        await sesion.execute(delete(VinculoMinka).where(VinculoMinka.origen == f"evento:{e.id}", VinculoMinka.destino == origen))
        return
    await quitar_vinculos(sesion, f"evento:{e.id}")
    await sesion.delete(e)


async def al_eliminar_origen(sesion, origen: str) -> int:
    """El documento (o recibido) `origen` se elimina: sus propuestos que nadie tocó se van con él
    (si otro documento vivo anuncia la misma actividad, pasan a ese). Lo que una persona confirmó
    o editó queda en la agenda. Sin commit. Devuelve cuántos retiró."""
    n = 0
    for e in await _vinculados(sesion, origen):
        if origen_de(e.externo_id) == origen and not _tocado(e):
            await _retirar(sesion, e, origen)
            n += 1
    return n


async def _fusionar(sesion, queda, absorbidos: list) -> None:
    """Junta en `queda` los vínculos, los participantes (con su respuesta de asistencia) y las
    referencias (avisos, mensajes del chat) de `absorbidos`, y los borra. Sin commit."""
    from sqlalchemy import select

    from minka.modelos import EventoParticipante
    from minka import eventos as salida
    from minka.tareas import poner_vinculos, repuntar_vinculos, vinculos_de

    destino = f"evento:{queda.id}"
    claves_viejas = [f"evento:{a.id}" for a in absorbidos]
    # Vínculos que salen del evento: la unión, sin repetir.
    vinc = await vinculos_de(sesion, [destino, *claves_viejas])
    union = list(dict.fromkeys(v for k in (destino, *claves_viejas) for v in vinc.get(k, [])))
    # Participantes: los de los absorbidos pasan; si ya estaba la misma persona, se suma su «confirmado».
    actuales = (await sesion.execute(select(EventoParticipante).where(EventoParticipante.evento_id == queda.id))).scalars().all()

    def llave(p) -> str:
        return f"u:{p.usuario_id}" if p.usuario_id else f"p:{p.persona_id}" if p.persona_id else f"n:{(p.nombre or '').strip().lower()}"

    por_llave = {llave(p): p for p in actuales}
    for a in absorbidos:
        for p in (await sesion.execute(select(EventoParticipante).where(EventoParticipante.evento_id == a.id))).scalars().all():
            ya = por_llave.get(llave(p))
            if ya is None:
                p.evento_id = queda.id
                por_llave[llave(p)] = p
            else:
                ya.confirmado = bool(ya.confirmado or p.confirmado)
                await sesion.delete(p)
    # Lo que apuntaba a los absorbidos (tareas vinculadas, avisos, tarjetas del chat) apunta a `queda`; lo que salía de
    # ellos se va (la unión ya está en `union`). Los vínculos son de Minka (minka_vinculos).
    await repuntar_vinculos(sesion, claves_viejas, destino)
    # Los avisos y los mensajes del chat que nombraban a los absorbidos son de Qillqa: se lo cuenta por la bandeja y ella
    # los reapunta (plataforma._al_reapuntar), a lo sumo 2 s después.
    salida.emitir(sesion, "referencias.reapuntar", destino, {"viejos": claves_viejas, "nuevo": destino})
    await sesion.flush()
    for a in absorbidos:
        await sesion.delete(a)
    await sesion.flush()
    await poner_vinculos(sesion, destino, union, None)


async def reconciliar(sesion) -> dict:
    """Idempotente (corre al arrancar y cada vuelta de los recordatorios): (1) fusiona los
    eventos detectados que son la misma actividad (plan_fusion); (2) retira los propuestos que
    nadie tocó cuyo documento o recibido ya no existe; (3) pone en los demás la etiqueta vigente
    de su documento. Hace commit si cambió algo. Devuelve los conteos."""
    from sqlalchemy import func, select
    from tiqsi.modulo import opcional

    from minka.modelos import EventoAgenda, EventoParticipante

    eventos = list((await sesion.execute(
        select(EventoAgenda).where(EventoAgenda.origen == "detectado", EventoAgenda.externo_id != "")
    )).scalars().all())
    if not eventos:
        return {"fusionados": 0, "retirados": 0, "recompuestos": 0}
    ids_doc = {int(origen_de(e.externo_id)[4:]) for e in eventos if origen_de(e.externo_id).startswith("doc:") and origen_de(e.externo_id)[4:].isdigit()}
    ids_ent = {int(origen_de(e.externo_id)[8:]) for e in eventos if origen_de(e.externo_id).startswith("entrada:") and origen_de(e.externo_id)[8:].isdigit()}
    # Qué documentos y recibidos siguen vivos, por el contrato; sin quien los da, todo se considera vivo (nada se
    # retira por no poder preguntar).
    servicio_docs, servicio_recibidos = opcional("documentos.v1"), opcional("recibidos.v1")
    if (ids_doc and servicio_docs is None) or (ids_ent and servicio_recibidos is None):
        return {"fusionados": 0, "retirados": 0, "recompuestos": 0}
    docs = await servicio_docs.fichas(ids_doc) if ids_doc else {}
    entradas = await servicio_recibidos.existen(ids_ent) if ids_ent else set()
    participantes = dict((await sesion.execute(
        select(EventoParticipante.evento_id, func.count()).where(EventoParticipante.evento_id.in_([e.id for e in eventos]))
        .group_by(EventoParticipante.evento_id)
    )).all())

    def vivo(e) -> bool:
        o = origen_de(e.externo_id)
        if o.startswith("doc:") and o[4:].isdigit():
            return int(o[4:]) in docs
        if o.startswith("entrada:") and o[8:].isdigit():
            return int(o[8:]) in entradas
        return True

    por_id = {e.id: e for e in eventos}
    filas = [{"id": e.id, "origen": origen_de(e.externo_id), "vivo": vivo(e), "clave": clave_de(e.externo_id) or _dia_local(e),
              "nombre": e.titulo, "tocado": _tocado(e), "participantes": participantes.get(e.id, 0)} for e in eventos
             if e.estado not in ("cancelado", "descartado")]
    fusionados = 0
    for queda_id, absorbidos in plan_fusion(filas):
        queda = por_id[queda_id]
        abs_ev = [por_id[i] for i in absorbidos]
        if not vivo(queda):
            heredero = next((a for a in abs_ev if vivo(a)), None)
            if heredero is not None:
                queda.externo_id = heredero.externo_id
        await _fusionar(sesion, queda, abs_ev)
        for i in absorbidos:
            por_id.pop(i, None)
        fusionados += len(absorbidos)
    retirados = 0
    for e in list(por_id.values()):
        if not vivo(e) and not _tocado(e) and not participantes.get(e.id):
            await _retirar(sesion, e, origen_de(e.externo_id))
            por_id.pop(e.id, None)
            retirados += 1
    recompuestos = 0
    for d in docs.values():
        recompuestos += await recomponer_de_documento(sesion, d)
    if fusionados or retirados or recompuestos:
        await sesion.commit()
        log.info("Agenda detectada reconciliada: %s fusionado(s), %s retirado(s), %s recompuesto(s).",
                 fusionados, retirados, recompuestos)
    return {"fusionados": fusionados, "retirados": retirados, "recompuestos": recompuestos}


async def descartar_evento(sesion, e) -> None:
    """Un evento detectado que alguien borró no vuelve a proponerse, ni desde su documento ni
    desde los otros que anuncian la misma actividad (vinculados). No hace commit."""
    from minka.tareas import vinculos_de

    clave = clave_de(e.externo_id)
    claves = [e.externo_id] if e.externo_id else []
    if clave:
        for v in (await vinculos_de(sesion, [f"evento:{e.id}"])).get(f"evento:{e.id}", []):
            if v.startswith(("doc:", "entrada:")):
                claves.append(f"{v}:{clave}")
    if claves:
        await descartar(sesion, claves)


async def descartar(sesion, externo_id: str | list[str]) -> None:
    """Un evento detectado que alguien borró no vuelve a proponerse (no hace commit)."""
    from minka.modelos import AjusteMinka

    fila = await sesion.get(AjusteMinka, CLAVE_DESCARTADOS)
    ids = list((fila.valor or {}).get("ids", [])) if fila else []
    nuevas = [c for c in dict.fromkeys([externo_id] if isinstance(externo_id, str) else externo_id) if c not in ids]
    if nuevas:
        ids = (ids + nuevas)[-2000:]
        if fila:
            fila.valor = {"ids": ids}
        else:
            sesion.add(AjusteMinka(clave=CLAVE_DESCARTADOS, valor={"ids": ids}))


async def proponer_de_entrada(sesion, entrada, usuario) -> int:
    """Agenda como «propuesto» lo que un documento RECIBIDO anuncia (2026-10-12, pendiente «citaciones
    en PDF desde Recibidos»): la misma detección de los documentos propios sobre el asunto y el texto
    del PDF; `externo_id` = `entrada:<id>:<clave>`, vínculo `evento:N → entrada:M`. No hace commit
    (corre dentro del registro de la entrada). Devuelve cuántos propuso. `entrada`: su ficha
    (punku_contrato._ficha, por «recibidos.v1»)."""
    from minka.modelos import EventoAgenda
    from minka.tareas import poner_vinculos

    try:
        referencia = date.fromisoformat(entrada["fecha"][:10])
    except ValueError:
        referencia = date.today()
    texto = f"{entrada['asunto']}\n{entrada['texto'][:20000]}"
    detectados = {d.clave: d for d in detectar(texto, referencia)}
    if not detectados:
        return 0
    prefijo = f"entrada:{entrada['id']}:"
    # Una actividad por recibido y día, también con las ya vinculadas (servicios de fusión arriba).
    dias = {_dia_local(e) for e in await _vinculados(sesion, f"entrada:{entrada['id']}")}
    descartados = await _descartados(sesion)
    hoy = datetime.now(ZONA).date()
    nuevos = 0
    for clave, d in detectados.items():
        externo = prefijo + clave
        if d.fecha.isoformat() in dias or externo in descartados or d.fecha < hoy:
            continue
        if await _ya_agendado(sesion, d):
            continue
        inicio = datetime.combine(d.fecha, d.hora or time(0, 0), ZONA)
        fin = (datetime.combine(d.fecha, d.hora_fin, ZONA) if d.hora_fin else inicio + timedelta(hours=1)) if d.hora else inicio
        e = EventoAgenda(
            titulo=f"{d.nombre}"[:300],
            descripcion=f"Detectado en el recibido {entrada['documento'] or entrada['std_numero'] or entrada['id']}: «{d.frase}»\n"
                        f"Remitente: {entrada['remitente']}\nAsunto: {entrada['asunto']}\nRevíselo y confírmelo o bórrelo.",
            tipo=tipo_de(d.frase), estado="propuesto", inicio=inicio, fin=fin, todo_el_dia=d.hora is None,
            lugar="", origen="detectado", externo_id=externo,
            creado_por=usuario.id if usuario else None, excepciones=[],
        )
        sesion.add(e)
        await sesion.flush()
        await poner_vinculos(sesion, f"evento:{e.id}", [f"entrada:{entrada['id']}"], usuario.id if usuario else None)
        dias.add(d.fecha.isoformat())
        nuevos += 1
    return nuevos
