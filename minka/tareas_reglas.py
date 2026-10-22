"""Reglas PURAS del módulo Tareas (2026-10-06): estados, prioridades, alta rápida en lenguaje
natural, plantillas de lista de verificación y rangos de las vistas. Sin base de datos: se
prueban en backend/tests/test_tareas.py. La base vive en servicios/tareas.py.

Alta rápida (al modo de Todoist): «revisar PL mañana 15:00 @usuario !alta #comision» →
título «revisar PL», plazo mañana a las 15:00, responsable la cuenta `usuario`, prioridad
alta y etiqueta «comision». Reconoce:

- fecha: hoy, mañana, pasado mañana, el lunes … domingo («próximo lunes» salta una semana),
  «en 3 días», «en 2 semanas», «próxima semana» (su lunes), 7/10, 7/10/2026, 2026-10-07,
  «7 de octubre»; con «para», «hasta» o «antes del» delante también;
- hora: 15:00, 3pm, 3:30 pm, 15 h, «a las 15»; una hora sin fecha es para hoy;
- @cuenta (responsable), !urgente !alta !normal !baja (o !! = alta, !!! = urgente), #etiqueta.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, time, timedelta, timezone, tzinfo

ESTADOS = ("por_hacer", "en_curso", "en_espera", "hecha", "cancelada")
ETIQUETA_ESTADO = {
    "por_hacer": "Por hacer",
    "en_curso": "En curso",
    "en_espera": "En espera",
    "hecha": "Hecha",
    "cancelada": "Cancelada",
}
ABIERTOS = ("por_hacer", "en_curso", "en_espera")
CERRADOS = ("hecha", "cancelada")

PRIORIDADES = ("baja", "normal", "alta", "urgente")
ETIQUETA_PRIORIDAD = {"baja": "Baja", "normal": "Normal", "alta": "Alta", "urgente": "Urgente"}
PESO_PRIORIDAD = {"urgente": 0, "alta": 1, "normal": 2, "baja": 3}

# Identificadores de lo que se puede vincular (los mismos del mapa de relaciones).
# `rend` (2026-10-18): una rendición de cuentas (api/rendiciones.py).
PREFIJOS_VINCULO = ("doc", "pl", "sr", "persona", "inst", "foto", "pedido", "evento", "tarea", "entrada", "rend")
_VINCULO = re.compile(r"^(%s):\d{1,9}$" % "|".join(PREFIJOS_VINCULO))


def vinculo_valido(destino: str) -> bool:
    return bool(_VINCULO.match((destino or "").strip()))


def normalizar(texto: str) -> str:
    """Minúsculas y sin tildes (la ñ se conserva)."""
    t = unicodedata.normalize("NFD", (texto or "").lower().replace("ñ", "\0"))
    return "".join(c for c in t if unicodedata.category(c) != "Mn").replace("\0", "ñ")


# --- alta rápida ---------------------------------------------------------------------------

_DIAS = {
    "lunes": 0, "martes": 1, "miercoles": 2, "jueves": 3, "viernes": 4, "sabado": 5, "domingo": 6,
}
_MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
    "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}
_PRIORIDAD_TOKEN = {
    "urgente": "urgente", "alta": "alta", "normal": "normal", "baja": "baja",
    "1": "urgente", "2": "alta", "3": "normal", "4": "baja",
}

_B = r"(?<![\w/:])"  # inicio de palabra (y no a mitad de una fecha u hora)
_E = r"(?![\w/:])"
_PREVIO = r"(?:(?:para|hasta|antes\s+del?|el|este|esta)\s+){0,2}"
_DIA_RE = r"(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)"
_MES_RE = r"(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)"


def _quitar(texto: str, m: re.Match) -> str:
    return texto[: m.start()] + " " + texto[m.end():]


def _hora(h: int, mi: int, sufijo: str | None) -> time | None:
    s = (sufijo or "").replace(".", "").replace(" ", "").lower()
    if s == "pm" and h < 12:
        h += 12
    elif s == "am" and h == 12:
        h = 0
    if 0 <= h <= 23 and 0 <= mi <= 59:
        return time(h, mi)
    return None


def _fecha_valida(a: int, m: int, d: int) -> date | None:
    try:
        return date(a, m, d)
    except ValueError:
        return None


def interpretar(texto: str, hoy: date, cuentas: list[str] | None = None) -> dict:
    """Desarma una línea de alta rápida. `cuentas`: los nombres de usuario que existen (para
    resolver @…; se acepta el inicio único de un nombre). Devuelve
    {titulo, fecha, hora, responsable, prioridad, etiquetas, reconocido, avisos}."""
    resto = f" {texto or ''} "
    reconocido: list[dict] = []
    avisos: list[str] = []
    cuentas = cuentas or []

    # @responsable
    responsable = None
    m = re.search(r"(?<![\w.])@([\w][\w.\-]*)", resto)
    if m:
        pedido = m.group(1).lower().rstrip(".")
        exacta = [c for c in cuentas if c.lower() == pedido]
        inicio = [c for c in cuentas if c.lower().startswith(pedido)]
        if exacta:
            responsable = exacta[0]
        elif len(inicio) == 1:
            responsable = inicio[0]
        else:
            avisos.append(f"No hay una cuenta «@{m.group(1)}»" if not inicio else f"«@{m.group(1)}» coincide con varias cuentas")
        if responsable:
            reconocido.append({"tipo": "responsable", "texto": m.group(0).strip()})
        resto = _quitar(resto, m)

    # !prioridad
    prioridad = None
    m = re.search(r"(?<!\w)!(urgente|alta|normal|baja|[1-4])(?!\w)", resto, re.I)
    if m:
        prioridad = _PRIORIDAD_TOKEN[m.group(1).lower()]
        reconocido.append({"tipo": "prioridad", "texto": m.group(0)})
        resto = _quitar(resto, m)
    else:
        m = re.search(r"(?<![\w!])(!{2,3})(?![\w!])", resto)
        if m:
            prioridad = "urgente" if len(m.group(1)) == 3 else "alta"
            reconocido.append({"tipo": "prioridad", "texto": m.group(0)})
            resto = _quitar(resto, m)

    # #etiquetas
    etiquetas: list[str] = []
    for m in list(re.finditer(r"(?<![\w&])#([\w][\w\-]*)", resto))[::-1]:
        etiquetas.insert(0, m.group(1).lower())
        reconocido.append({"tipo": "etiqueta", "texto": m.group(0)})
        resto = _quitar(resto, m)

    # hora
    hora = None
    patrones_hora = [
        (rf"{_B}(?:a\s+las?\s+)?(\d{{1,2}}):(\d{{2}})\s*(a\.?\s?m\.?|p\.?\s?m\.?)?{_E}", True),
        (rf"{_B}(?:a\s+las?\s+)?(\d{{1,2}})\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![\w])", False),
        (rf"{_B}(?:a\s+las?\s+)?(\d{{1,2}})\s*(?:h|hrs?|horas)(?![\w])", False),
        (rf"{_B}a\s+las?\s+(\d{{1,2}})(?![\w/:])", False),
    ]
    for patron, con_minutos in patrones_hora:
        m = re.search(patron, resto, re.I)
        if not m:
            continue
        if con_minutos:
            h = _hora(int(m.group(1)), int(m.group(2)), m.group(3))
        else:
            suf = m.group(2) if m.lastindex and m.lastindex >= 2 else None
            h = _hora(int(m.group(1)), 0, suf)
        if h is not None:
            hora = h
            reconocido.append({"tipo": "hora", "texto": m.group(0).strip()})
            resto = _quitar(resto, m)
            break

    # fecha
    fecha = None

    def tomar(m: re.Match, valor: date | None) -> None:
        nonlocal fecha, resto
        if valor is None:
            return
        fecha = valor
        reconocido.append({"tipo": "fecha", "texto": m.group(0).strip()})
        resto = _quitar(resto, m)

    reglas = [
        (rf"{_B}{_PREVIO}pasado\s+ma[ñn]ana{_E}", lambda m: hoy + timedelta(days=2)),
        (rf"{_B}{_PREVIO}ma[ñn]ana{_E}", lambda m: hoy + timedelta(days=1)),
        (rf"{_B}{_PREVIO}hoy{_E}", lambda m: hoy),
        (rf"{_B}{_PREVIO}en\s+(\d{{1,3}})\s+d[ií]as?{_E}", lambda m: hoy + timedelta(days=int(m.group(1)))),
        (rf"{_B}{_PREVIO}en\s+(\d{{1,2}})\s+semanas?{_E}", lambda m: hoy + timedelta(weeks=int(m.group(1)))),
        (rf"{_B}{_PREVIO}(?:la\s+)?pr[oó]xima\s+semana{_E}", lambda m: hoy + timedelta(days=7 - hoy.weekday())),
        (rf"{_B}{_PREVIO}(pr[oó]ximo\s+)?{_DIA_RE}{_E}", lambda m: _proximo_dia(hoy, m.group(2), bool(m.group(1)))),
        (rf"{_B}{_PREVIO}(\d{{4}})-(\d{{2}})-(\d{{2}}){_E}", lambda m: _fecha_valida(int(m.group(1)), int(m.group(2)), int(m.group(3)))),
        (rf"{_B}{_PREVIO}(\d{{1,2}})/(\d{{1,2}})(?:/(\d{{2,4}}))?{_E}", lambda m: _dia_mes(hoy, int(m.group(1)), int(m.group(2)), m.group(3))),
        (rf"{_B}{_PREVIO}(\d{{1,2}})\s+de\s+{_MES_RE}(?:\s+(?:de\s+|del\s+)?(\d{{4}}))?{_E}", lambda m: _dia_mes(hoy, int(m.group(1)), _MESES[normalizar(m.group(2))], m.group(3))),
    ]
    for patron, calcular in reglas:
        m = re.search(patron, resto, re.I)
        if m:
            tomar(m, calcular(m))
            if fecha is not None:
                break

    if hora is not None and fecha is None:
        fecha = hoy

    titulo = re.sub(r"\s+", " ", resto).strip(" ,;-–—")
    return {
        "titulo": titulo,
        "fecha": fecha.isoformat() if fecha else None,
        "hora": hora.strftime("%H:%M") if hora else None,
        "responsable": responsable,
        "prioridad": prioridad,
        "etiquetas": etiquetas,
        "reconocido": reconocido,
        "avisos": avisos,
    }


def _proximo_dia(hoy: date, nombre: str, proximo: bool) -> date:
    objetivo = _DIAS[normalizar(nombre)]
    salto = (objetivo - hoy.weekday()) % 7
    if proximo:
        salto = salto + 7 if salto else 7
    return hoy + timedelta(days=salto)


def _dia_mes(hoy: date, d: int, m: int, anio: str | None) -> date | None:
    if anio:
        a = int(anio)
        if a < 100:
            a += 2000
        return _fecha_valida(a, m, d)
    f = _fecha_valida(hoy.year, m, d)
    if f is not None and f < hoy - timedelta(days=31):
        f = _fecha_valida(hoy.year + 1, m, d)  # «3/1» en diciembre es el próximo enero
    return f


def plazo(fecha: str | None, hora: str | None, tz: tzinfo) -> tuple[datetime | None, bool]:
    """(vence_en, con_hora) desde fecha ISO y hora HH:MM. Sin hora: las 23:59 de ese día."""
    if not fecha:
        return None, False
    d = date.fromisoformat(fecha[:10])
    if hora:
        h, mi = (int(x) for x in hora[:5].split(":"))
        return datetime.combine(d, time(h, mi), tz), True
    return datetime.combine(d, time(23, 59), tz), False


# --- vistas --------------------------------------------------------------------------------

VISTAS = ("todas", "mias", "hoy", "vencidas", "semana", "sin_fecha", "hechas")


def rango_vista(vista: str, ahora: datetime, tz: tzinfo) -> tuple[datetime | None, datetime | None]:
    """Límites (desde, hasta) del plazo para una vista; None = sin límite. «hoy» incluye lo
    vencido (como Todoist: lo atrasado sigue siendo de hoy); «semana», hoy y los 7 días
    siguientes; «vencidas», lo que venció antes de este momento."""
    local = ahora.astimezone(tz)
    fin_hoy = datetime.combine(local.date(), time(23, 59, 59), tz)
    if vista == "hoy":
        return None, fin_hoy
    if vista == "vencidas":
        return None, ahora
    if vista == "semana":
        return None, fin_hoy + timedelta(days=7)
    return None, None


def vencida(vence_en: datetime | None, con_hora: bool, estado: str, ahora: datetime, tz: tzinfo) -> bool:
    """Una tarea con fecha (sin hora) vence al terminar su día; con hora, a esa hora."""
    if vence_en is None or estado in CERRADOS:
        return False
    if con_hora:
        return vence_en < ahora
    return vence_en.astimezone(tz).date() < ahora.astimezone(tz).date()


def orden_lista(t: dict) -> tuple:
    """Orden de «Mis tareas»: primero lo vencido y con plazo más cercano, después por prioridad."""
    vence = t.get("vence_en") or "9999"
    return (t.get("estado") in CERRADOS, vence, PESO_PRIORIDAD.get(t.get("prioridad") or "normal", 2), t.get("id") or 0)


# --- plantillas de lista de verificación ---------------------------------------------------
#
# Genéricas (nada de la entidad): lo que se repite en el trabajo parlamentario según el
# análisis del chat del equipo. `dias` es el desfase respecto de la fecha de referencia
# (inicio de la semana, día de la sesión, fecha de inicio del proyecto). Aplicar una plantilla
# crea UNA tarea con su lista de verificación o, con `separar`, una lista con una tarea por
# paso y su propio plazo.

PLANTILLAS: dict[str, dict] = {
    "semana_representacion": {
        "nombre": "Semana de representación",
        "descripcion": "De la programación a la rendición de viáticos. Fecha de referencia: el lunes de la semana.",
        "referencia": "Inicio de la semana",
        "pasos": [
            ("Oficio de fechas de la semana de representación", -20),
            ("Oficios de visita a las instituciones", -10),
            ("Solicitud de viáticos y pasajes", -7),
            ("Pasajes de los acompañantes", -7),
            ("Agenda de campo confirmada", -2),
            ("Bitácora diaria de actividades", 4),
            ("Fotos de cada actividad en la Fototeca", 4),
            ("Borrador del informe", 7),
            ("Revisión y firma del informe", 9),
            ("Ingreso del informe al trámite documentario", 10),
            ("Rendición de viáticos", 10),
        ],
    },
    "sesion_comision": {
        "nombre": "Sesión de comisión",
        "descripcion": "Preparar, asistir y registrar una sesión. Fecha de referencia: el día de la sesión.",
        "referencia": "Día de la sesión",
        "pasos": [
            ("Descargar la citación y la agenda", -2),
            ("Reunir los proyectos de ley de la agenda", -2),
            ("Pedir opinión al asesor sobre cada punto", -1),
            ("Ayuda memoria para la sesión", -1),
            ("Asistir a la sesión (o acreditar al acompañante)", 0),
            ("Registrar acuerdos y el acta", 1),
        ],
    },
    "proyecto_ley": {
        "nombre": "Proyecto de ley",
        "descripcion": "Del primer avance al registro del número de ingreso. Fecha de referencia: el inicio del trabajo.",
        "referencia": "Inicio del trabajo",
        "pasos": [
            ("Primer avance del texto", 0),
            ("Revisión y observaciones del equipo", 3),
            ("Firma del titular", 5),
            ("Firmas de adhesión de otros despachos", 7),
            ("Validar las firmas digitales", 8),
            ("Ingreso al trámite documentario", 9),
            ("Registrar el número y la fecha de ingreso", 10),
        ],
    },
    "pedido_informacion": {
        "nombre": "Pedido de información",
        "descripcion": "Oficio con plazo de respuesta. Fecha de referencia: el día del envío.",
        "referencia": "Día del envío",
        "pasos": [
            ("Redactar y numerar el oficio", -1),
            ("Firmar y enviar; archivar el cargo", 0),
            ("Seguimiento del trámite a los 7 días", 7),
            ("Reiterar si no hay respuesta", 15),
            ("Registrar la respuesta y vincularla al oficio", 20),
        ],
    },
}


def plantillas_publicas() -> list[dict]:
    return [
        {"clave": k, "nombre": v["nombre"], "descripcion": v["descripcion"], "referencia": v["referencia"],
         "pasos": [{"texto": t, "dias": d} for t, d in v["pasos"]]}
        for k, v in PLANTILLAS.items()
    ]


def checklist_de(clave: str) -> list[dict]:
    p = PLANTILLAS[clave]
    return [{"id": f"p{i + 1}", "texto": t, "hecha": False} for i, (t, _) in enumerate(p["pasos"])]


def pasos_con_fecha(clave: str, referencia: date) -> list[tuple[str, date]]:
    return [(t, referencia + timedelta(days=d)) for t, d in PLANTILLAS[clave]["pasos"]]


def limpiar_checklist(items) -> list[dict]:
    """Normaliza la lista de verificación que llega del cliente."""
    salida = []
    for i, it in enumerate(items or []):
        if not isinstance(it, dict):
            continue
        texto = str(it.get("texto") or "").strip()[:500]
        if not texto:
            continue
        salida.append({"id": str(it.get("id") or f"c{i + 1}")[:20], "texto": texto, "hecha": bool(it.get("hecha"))})
    return salida[:200]


def limpiar_etiquetas(etiquetas) -> list[str]:
    vistas: list[str] = []
    for e in etiquetas or []:
        e = re.sub(r"\s+", "-", str(e).strip().lstrip("#").lower())[:40]
        if e and e not in vistas:
            vistas.append(e)
    return vistas[:20]


def ahora_utc() -> datetime:
    return datetime.now(timezone.utc)


# --- Matriz de Eisenhower (2026-10-08) -------------------------------------------------------
# Cada tarea cae SOLA en su cuadrante: nadie la ordena a mano (Edison: «con solo llenar un
# evento debe ir ordenándose en el calendario, en la matriz, en el tablero»).
CUADRANTES = ("hacer", "planificar", "delegar", "despues")
DIAS_URGENTE = 2


def es_urgente(vence_en: datetime | None, prioridad: str, ahora: datetime) -> bool:
    """Urgente = vence en 2 días o menos (o ya venció), o se marcó «urgente»."""
    if prioridad == "urgente":
        return True
    return vence_en is not None and vence_en <= ahora + timedelta(days=DIAS_URGENTE)


def es_importante(importante: bool, prioridad: str) -> bool:
    """Importante = se marcó así, o tiene prioridad alta. «Urgente» habla del tiempo, no de la
    importancia: por eso una tarea urgente sin marcar cae en «Delegar»."""
    return importante or prioridad == "alta"


def cuadrante(vence_en: datetime | None, prioridad: str, importante: bool, ahora: datetime) -> str:
    u = es_urgente(vence_en, prioridad, ahora)
    i = es_importante(importante, prioridad)
    return "hacer" if u and i else "planificar" if i else "delegar" if u else "despues"


# --- pegar un plan de tareas (2026-10-12; bloque `plan-de-tareas`, POST /api/tareas/pegar) ---------

_TRATAMIENTOS = {"sr", "sra", "srta", "senor", "senora", "lic", "dr", "dra", "ing", "abg", "abog", "prof", "mg", "el", "la", "don", "dona"}


def _palabras(texto: str) -> list[str]:
    return [p for p in re.split(r"[^\wñ]+", normalizar(texto)) if p and p not in _TRATAMIENTOS]


def casar_responsable(nombre: str, usuarios: list[dict]) -> dict | None:
    """Un nombre del pegado → la cuenta del equipo (`{id, usuario, nombre, …}` de
    `usuarios_activos`) que le corresponde SIN ambigüedad; None si nadie o varios.

    Casa por la cuenta («@asesor1» o «asesor1»), por el nombre completo, o por palabras: todas
    las del pegado están en el nombre de una sola persona («María» o «María Quispe» casan con
    «María Elena Quispe Rojas» si nadie más se llama así). Ignora tratamientos (Sr., Lic., Dra.)."""
    crudo = normalizar(nombre or "").strip().lstrip("@").strip()
    if not crudo:
        return None
    exactas = [u for u in usuarios if crudo in (normalizar(u.get("usuario") or ""), normalizar(u.get("nombre") or "").strip())]
    if len(exactas) == 1:
        return exactas[0]
    buscadas = _palabras(crudo)
    if not buscadas:
        return None
    candidatas = [u for u in usuarios if set(buscadas) <= set(_palabras(u.get("nombre") or ""))]
    return candidatas[0] if len(candidatas) == 1 else None


def clave_tarea(titulo: str) -> str:
    """El título comparable para no duplicar: sin tildes, mayúsculas, puntuación ni espacios de más."""
    return " ".join(re.split(r"[^\wñ]+", normalizar(titulo or ""))).strip()


# --- clase: interna o externa (2026-10-18) -------------------------------------------------
#
# Edison: «distinguir las tareas internas de la entidad (subir cargos, firmar, trámites) de las
# actividades o agendas externas (reuniones, audiencias, compromisos institucionales)». La decide
# una persona en la ficha (`clase`); si no, el sistema: lo que crea solo el trámite es interno; lo
# vinculado a un evento de la agenda o que empieza por ir, asistir, reunirse… es externo.

CLASES = {"interna": "Interna", "externa": "Externa"}
_EXTERNA = re.compile(
    r"^(asistir|acudir|ir|participar|acompa[nñ]ar|viajar|visitar|visita|reunion|reunirse|audiencia|sesion|"
    r"mesa (?:tecnica|de trabajo|de dialogo)|foro|ceremonia|inauguracion|entrevista|conferencia|congreso|"
    r"juramentacion|recibir a|atender a|exponer|presentarse|inspeccion|desfile|asamblea|taller|conversatorio)\b"
)


def clase_tarea(titulo: str, origen: str = "", clase: str = "", vinculos: list[str] | None = None) -> str:
    """«interna» o «externa». Pura."""
    if clase in CLASES:
        return clase
    if origen == "automatica":
        return "interna"
    if any(str(v).startswith("evento:") for v in vinculos or []):
        return "externa"
    return "externa" if _EXTERNA.match(normalizar(titulo or "").strip()) else "interna"


# --- ¿ya existe algo parecido? (2026-10-18) ------------------------------------------------
#
# Al pegar el resultado de un prompt o al escribir una tarea nueva, el sistema avisa si ya hay una
# parecida y deja abrirla antes de crear otra. El mismo criterio que `evento_parecido` (Jaccard de
# palabras de 4 letras o más), con una salvedad: si los dos títulos citan números (el 0149 de un
# oficio) y no son los mismos, no son la misma tarea.

UMBRAL_PARECIDO = 0.6


def _cifras(texto: str) -> set[str]:
    return {c.lstrip("0") or "0" for c in re.findall(r"\d{2,}", texto or "")}


def parecido(a: str, b: str, mismo_dia: bool = False) -> float:
    """0 a 1,25: cuánto se parecen dos títulos (+0,25 si vencen o empiezan el mismo día). Pura."""
    if clave_tarea(a) and clave_tarea(a) == clave_tarea(b):
        return 1.0 + (0.25 if mismo_dia else 0.0)
    ca, cb = _cifras(a), _cifras(b)
    if ca and cb and ca != cb:
        return 0.0
    pa = {p for p in clave_tarea(a).split() if len(p) >= 4}
    pb = {p for p in clave_tarea(b).split() if len(p) >= 4}
    if not pa or not pb:
        return 0.0
    return len(pa & pb) / len(pa | pb) + (0.25 if mismo_dia else 0.0)
