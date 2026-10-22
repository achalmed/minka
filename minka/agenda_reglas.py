"""Reglas PURAS de la Agenda (2026-10-06): tipos y estados de evento, recurrencia semanal
simple, detección de choques y calendario ICS (RFC 5545) de ida y vuelta. Sin base de datos:
se prueban en backend/tests/test_agenda.py. Sin dependencias: el ICS se escribe y se lee a
mano (lo justo para Google Calendar, Outlook, Thunderbird y Super Productivity).

Recurrencia: {"frecuencia": "semanal", "intervalo": 1, "dias": [1, 2], "hasta": "2026-12-15"}
con 0 = lunes … 6 = domingo; «diaria» equivale a semanal todos los días. Las ocurrencias se
calculan en la HORA LOCAL de la entidad (una sesión de las 15:00 sigue a las 15:00 aunque
cambie el horario de verano en otra zona) y se devuelven con zona.
"""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo

TIPOS = {
    "pleno": "Pleno",
    "comision": "Comisión",
    "despacho": "Reunión en el despacho",
    "externa": "Reunión o evento externo",
    "semana_representacion": "Semana de representación",
    "medio": "Medio o entrevista",
    "otro": "Otro",
}
ESTADOS = {
    "propuesto": "Por confirmar",
    "confirmado": "Confirmado",
    "suspendido": "Suspendido",
    "realizado": "Realizado",
    "cancelado": "Cancelado",
    "descartado": "Descartado",
}
INACTIVOS = ("suspendido", "cancelado", "descartado")
# Una SOLICITUD (2026-10-18, Edison: «el calendario y la agenda oficial del diputado solo muestran
# lo confirmado»): lo pedido por un gremio, una institución o detectado en un documento espera en la
# lista «Por confirmar» hasta que alguien lo confirma (pasa al calendario) o lo descarta. Ni el
# calendario, ni la programación del día, ni los recordatorios, ni el tema «Agenda» del chat, ni el
# ICS muestran una solicitud.
POR_CONFIRMAR = "propuesto"
SOLICITUD = ("propuesto", "descartado")
MODALIDADES = {"presencial": "Presencial", "virtual": "Virtual", "mixta": "Mixta"}
ROLES_PARTICIPANTE = {"titular": "Titular", "acompana": "Acompaña", "responsable": "Responsable", "invitado": "Invitado"}
# Lo que el titular no puede partir en dos: un choque entre estos tipos es grave.
TIPOS_OFICIALES = ("pleno", "comision")
DURACION_POR_OMISION = timedelta(hours=1)
_DIAS_ICS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
MAX_OCURRENCIAS = 2000


def en_calendario(estado: str | None) -> bool:
    """¿Va al calendario (y a todo lo que lo alimenta)? Todo menos una solicitud."""
    return (estado or "confirmado") not in SOLICITUD


def anunciable(estado: str | None) -> bool:
    """¿Se cuenta en el chat como «Agendado»? Lo confirmado (no lo cancelado ni lo suspendido)."""
    return en_calendario(estado) and (estado or "confirmado") not in INACTIVOS


def estado_de_pegado(confirmacion: str | None) -> str:
    """El estado con que entra una actividad pegada: si el prompt anota cómo o hasta cuándo se
    confirma la asistencia, es una invitación o un pedido aún sin respuesta → por confirmar."""
    return POR_CONFIRMAR if (confirmacion or "").strip() else "confirmado"


# --- recurrencia ---------------------------------------------------------------------------


def limpiar_recurrencia(r) -> dict | None:
    """Normaliza la recurrencia que llega del cliente; None si no hay o no es válida."""
    if not isinstance(r, dict):
        return None
    frecuencia = str(r.get("frecuencia") or "").lower()
    if frecuencia not in ("semanal", "diaria"):
        return None
    if frecuencia == "diaria":
        dias = list(range(7))
        intervalo = 1
    else:
        dias = sorted({int(d) for d in (r.get("dias") or []) if str(d).lstrip("-").isdigit() and 0 <= int(d) <= 6})
        try:
            intervalo = max(1, min(8, int(r.get("intervalo") or 1)))
        except (TypeError, ValueError):
            intervalo = 1
    hasta = str(r.get("hasta") or "")[:10]
    try:
        hasta = date.fromisoformat(hasta).isoformat() if hasta else None
    except ValueError:
        hasta = None
    return {"frecuencia": frecuencia, "intervalo": intervalo, "dias": dias, "hasta": hasta}


def ocurrencias(
    inicio: datetime,
    fin: datetime | None,
    recurrencia: dict | None,
    excepciones: list[str] | None,
    desde: datetime,
    hasta: datetime,
    tz: tzinfo,
) -> list[tuple[datetime, datetime | None]]:
    """Las ocurrencias (inicio, fin) que tocan la ventana [desde, hasta). Un evento único
    devuelve 0 o 1. Las fechas de `excepciones` (inicio local, ISO) se saltan."""
    duracion = (fin - inicio) if fin is not None else None
    fin_efectivo = lambda i: i + (duracion if duracion is not None else DURACION_POR_OMISION)  # noqa: E731
    excluidas = set(excepciones or [])
    if not recurrencia:
        if inicio < hasta and fin_efectivo(inicio) > desde and inicio.astimezone(tz).date().isoformat() not in excluidas:
            return [(inicio, fin)]
        return []
    r = limpiar_recurrencia(recurrencia)
    if r is None:
        return ocurrencias(inicio, fin, None, excepciones, desde, hasta, tz)
    local = inicio.astimezone(tz)
    hora = local.timetz().replace(tzinfo=None)
    dias = r["dias"] or [local.weekday()]
    intervalo = r["intervalo"]
    tope = date.fromisoformat(r["hasta"]) if r["hasta"] else None
    lunes = local.date() - timedelta(days=local.weekday())
    desde_local = (desde - (duracion or DURACION_POR_OMISION)).astimezone(tz).date()
    semana = max(0, (desde_local - lunes).days // 7 - 1)
    semana -= semana % intervalo
    salida: list[tuple[datetime, datetime | None]] = []
    while len(salida) < MAX_OCURRENCIAS:
        base = lunes + timedelta(weeks=semana)
        if tope and base > tope:
            break
        if datetime.combine(base, time(0), tz) >= hasta:
            break
        for d in dias:
            dia = base + timedelta(days=d)
            if dia < local.date() or (tope and dia > tope):
                continue
            if dia.isoformat() in excluidas:
                continue
            i = datetime.combine(dia, hora, tz)
            if i < hasta and fin_efectivo(i) > desde:
                salida.append((i, i + duracion if duracion is not None else None))
        semana += intervalo
    return salida


# --- choques -------------------------------------------------------------------------------


def choques(ocs: list[dict]) -> list[dict]:
    """Pares de ocurrencias que se superponen. Cada ocurrencia: {clave, id, titulo, tipo,
    estado, inicio, fin, todo_el_dia, participantes: set[str]}. No cuentan las de todo el
    día ni las suspendidas o canceladas, ni dos ocurrencias del mismo evento. Gravedad «alta»
    si comparten participante o si ambas son pleno o comisión (el titular no puede estar en
    dos); «media» en otro caso (simultáneas en la agenda de la entidad)."""
    activas = [o for o in ocs if not o.get("todo_el_dia") and o.get("estado") not in INACTIVOS]
    activas.sort(key=lambda o: o["inicio"])
    salida = []
    for i, a in enumerate(activas):
        fin_a = a.get("fin") or a["inicio"] + DURACION_POR_OMISION
        for b in activas[i + 1:]:
            if b["inicio"] >= fin_a:
                break
            if a["id"] == b["id"]:
                continue
            fin_b = b.get("fin") or b["inicio"] + DURACION_POR_OMISION
            if b["inicio"] < fin_a and a["inicio"] < fin_b:
                comunes = sorted(set(a.get("participantes") or ()) & set(b.get("participantes") or ()))
                oficiales = a.get("tipo") in TIPOS_OFICIALES and b.get("tipo") in TIPOS_OFICIALES
                salida.append({
                    "a": a["clave"], "b": b["clave"],
                    "titulo_a": a.get("titulo", ""), "titulo_b": b.get("titulo", ""),
                    "desde": max(a["inicio"], b["inicio"]), "hasta": min(fin_a, fin_b),
                    "comparten": comunes,
                    "gravedad": "alta" if comunes or oficiales else "media",
                })
    return salida


# --- ICS: exportar -------------------------------------------------------------------------


def _escapar(texto: str) -> str:
    return (
        (texto or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
        .replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "")
    )


def _plegar(linea: str) -> str:
    """Líneas de 75 octetos como mucho (RFC 5545 §3.1), sin partir un carácter UTF-8."""
    salida, actual, largo = [], "", 0
    for c in linea:
        n = len(c.encode("utf-8"))
        if largo + n > (75 if not salida else 74):
            salida.append(actual)
            actual, largo = "", 0
        actual += c
        largo += n
    salida.append(actual)
    return "\r\n ".join(salida)


def _utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _rrule(r: dict, inicio_local: datetime, tz: tzinfo) -> str:
    dias = r.get("dias") or [inicio_local.weekday()]
    partes = ["FREQ=WEEKLY", f"INTERVAL={r.get('intervalo') or 1}", "BYDAY=" + ",".join(_DIAS_ICS[d] for d in dias), "WKST=MO"]
    if r.get("hasta"):
        partes.append("UNTIL=" + _utc(datetime.combine(date.fromisoformat(r["hasta"]), time(23, 59, 59), tz)))
    return ";".join(partes)


def exportar_ics(eventos: list[dict], nombre: str, tz: tzinfo, ahora: datetime, dominio: str = "qillqa") -> str:
    """Calendario ICS. Cada evento: {uid, titulo, descripcion, lugar, enlace, inicio, fin,
    todo_el_dia, recurrencia, excepciones, estado, tipo, actualizado}."""
    zona = getattr(tz, "key", "UTC")
    lineas = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Qillqa//Tareas y Agenda//ES", "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH", f"X-WR-CALNAME:{_escapar(nombre)}", f"X-WR-TIMEZONE:{zona}",
        "REFRESH-INTERVAL;VALUE=DURATION:PT30M", "X-PUBLISHED-TTL:PT30M",
    ]
    for e in eventos:
        inicio: datetime = e["inicio"]
        fin: datetime | None = e.get("fin")
        local = inicio.astimezone(tz)
        lineas += ["BEGIN:VEVENT", f"UID:{e['uid']}@{dominio}", f"DTSTAMP:{_utc(e.get('actualizado') or ahora)}"]
        if e.get("todo_el_dia"):
            dia_fin = (fin.astimezone(tz).date() if fin else local.date()) + timedelta(days=1)
            if dia_fin <= local.date():
                dia_fin = local.date() + timedelta(days=1)
            lineas += [f"DTSTART;VALUE=DATE:{local.strftime('%Y%m%d')}", f"DTEND;VALUE=DATE:{dia_fin.strftime('%Y%m%d')}"]
        else:
            lineas += [f"DTSTART:{_utc(inicio)}", f"DTEND:{_utc(fin or inicio + DURACION_POR_OMISION)}"]
        r = limpiar_recurrencia(e.get("recurrencia"))
        if r:
            lineas.append("RRULE:" + _rrule(r, local, tz))
            for f in e.get("excepciones") or []:
                try:
                    d = date.fromisoformat(f)
                except ValueError:
                    continue
                if e.get("todo_el_dia"):
                    lineas.append(f"EXDATE;VALUE=DATE:{d.strftime('%Y%m%d')}")
                else:
                    lineas.append("EXDATE:" + _utc(datetime.combine(d, local.timetz().replace(tzinfo=None), tz)))
        lineas.append("SUMMARY:" + _escapar(e.get("titulo") or ""))
        descripcion = e.get("descripcion") or ""
        if e.get("enlace"):
            descripcion = f"{descripcion}\n\nEnlace: {e['enlace']}".strip()
        if descripcion:
            lineas.append("DESCRIPTION:" + _escapar(descripcion))
        if e.get("lugar"):
            lineas.append("LOCATION:" + _escapar(e["lugar"]))
        if e.get("enlace"):
            lineas.append("URL:" + e["enlace"].replace("\n", ""))
        if e.get("tipo"):
            lineas.append("CATEGORIES:" + _escapar(TIPOS.get(e["tipo"], e["tipo"])))
        estado = e.get("estado") or "confirmado"
        lineas.append("STATUS:" + ("CANCELLED" if estado in INACTIVOS else "TENTATIVE" if estado == "propuesto" else "CONFIRMED"))
        lineas.append("END:VEVENT")
    lineas.append("END:VCALENDAR")
    return "\r\n".join(_plegar(x) for x in lineas) + "\r\n"


# --- ICS: importar -------------------------------------------------------------------------


def _desplegar(texto: str) -> list[str]:
    lineas: list[str] = []
    for crudo in texto.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if crudo[:1] in (" ", "\t") and lineas:
            lineas[-1] += crudo[1:]
        elif crudo:
            lineas.append(crudo)
    return lineas


def _desescapar(v: str) -> str:
    return re.sub(r"\\([\\;,nN])", lambda m: "\n" if m.group(1) in "nN" else m.group(1), v)


def _propiedad(linea: str) -> tuple[str, dict, str]:
    # NOMBRE;PARAM=VALOR;PARAM2="V":valor — los dos puntos de un parámetro entre comillas no cuentan.
    entre, corte = False, -1
    for i, c in enumerate(linea):
        if c == '"':
            entre = not entre
        elif c == ":" and not entre:
            corte = i
            break
    if corte < 0:
        return linea.upper(), {}, ""
    cabeza, valor = linea[:corte], linea[corte + 1:]
    partes = cabeza.split(";")
    params = {}
    for p in partes[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            params[k.upper()] = v.strip('"')
    return partes[0].upper(), params, valor


def _fecha_ics(valor: str, params: dict, tz: tzinfo) -> tuple[datetime, bool]:
    """(momento con zona, es_fecha_sola)."""
    v = valor.strip()
    if params.get("VALUE", "").upper() == "DATE" or re.fullmatch(r"\d{8}", v):
        d = datetime.strptime(v[:8], "%Y%m%d").date()
        return datetime.combine(d, time(0), tz), True
    if v.endswith("Z"):
        return datetime.strptime(v[:15], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc), False
    zona: tzinfo = tz
    if params.get("TZID"):
        try:
            zona = ZoneInfo(params["TZID"])
        except Exception:  # zona de Windows u otra desconocida: la de la entidad
            zona = tz
    return datetime.strptime(v[:15], "%Y%m%dT%H%M%S").replace(tzinfo=zona), False


def _duracion(v: str) -> timedelta | None:
    m = re.fullmatch(r"([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", v.strip())
    if not m:
        return None
    sem, d, h, mi, s = (int(x or 0) for x in m.groups()[1:])
    return timedelta(weeks=sem, days=d, hours=h, minutes=mi, seconds=s)


def _rrule_a_recurrencia(valor: str, inicio_local: datetime, tz: tzinfo) -> tuple[dict | None, str]:
    """RRULE → recurrencia simple. Devuelve (recurrencia, aviso)."""
    p = dict(x.split("=", 1) for x in valor.split(";") if "=" in x)
    frecuencia = p.get("FREQ", "").upper()
    intervalo = int(p.get("INTERVAL", "1") or 1)
    if frecuencia == "DAILY" and intervalo == 1:
        dias = list(range(7))
    elif frecuencia == "WEEKLY":
        dias = sorted({_DIAS_ICS.index(d[-2:]) for d in p.get("BYDAY", "").split(",") if d[-2:] in _DIAS_ICS}) or [inicio_local.weekday()]
    else:
        return None, f"Repetición «{frecuencia or valor}» no admitida: se importa solo la primera vez"
    hasta = None
    if p.get("UNTIL"):
        u, _ = _fecha_ics(p["UNTIL"], {}, tz)
        hasta = u.astimezone(tz).date().isoformat()
    elif p.get("COUNT"):
        veces = int(p["COUNT"])
        # Aproximado por semanas completas (la última semana puede tener días de más si
        # BYDAY lleva varios): basta para una agenda; se anota en la vista previa.
        semanas = (-(-veces // len(dias)) - 1) * intervalo
        hasta = (inicio_local.date() + timedelta(weeks=semanas, days=6)).isoformat()
    return {"frecuencia": "semanal", "intervalo": intervalo, "dias": dias, "hasta": hasta}, ""


def importar_ics(texto: str, tz: tzinfo) -> tuple[list[dict], list[str]]:
    """Eventos de un archivo ICS → (eventos, avisos). Cada evento: {externo_id, titulo,
    descripcion, lugar, enlace, inicio, fin, todo_el_dia, recurrencia, excepciones, estado}."""
    eventos: list[dict] = []
    avisos: list[str] = []
    actual: dict | None = None
    profundidad = 0  # VALARM y otros bloques dentro del VEVENT se ignoran
    for linea in _desplegar(texto):
        nombre, params, valor = _propiedad(linea)
        if nombre == "BEGIN" and valor.upper() == "VEVENT":
            actual, profundidad = {"excepciones": [], "params": {}}, 0
            continue
        if actual is None:
            continue
        if nombre == "BEGIN":
            profundidad += 1
            continue
        if nombre == "END" and valor.upper() != "VEVENT":
            profundidad = max(0, profundidad - 1)
            continue
        if nombre == "END":
            ev = _cerrar_evento(actual, tz, avisos)
            if ev:
                eventos.append(ev)
            actual = None
            continue
        if profundidad:
            continue
        if nombre == "EXDATE":
            actual["excepciones"] += [(v, params) for v in valor.split(",") if v]
        else:
            actual[nombre] = valor
            actual["params"][nombre] = params
    return eventos, avisos


def _cerrar_evento(a: dict, tz: tzinfo, avisos: list[str]) -> dict | None:
    if "DTSTART" not in a:
        avisos.append(f"Evento sin fecha de inicio omitido: {_desescapar(a.get('SUMMARY', ''))[:80]}")
        return None
    try:
        inicio, solo_fecha = _fecha_ics(a["DTSTART"], a["params"].get("DTSTART", {}), tz)
    except ValueError:
        avisos.append(f"Fecha ilegible omitida: {a['DTSTART']}")
        return None
    fin = None
    if a.get("DTEND"):
        try:
            fin, _ = _fecha_ics(a["DTEND"], a["params"].get("DTEND", {}), tz)
        except ValueError:
            fin = None
    elif a.get("DURATION"):
        d = _duracion(a["DURATION"])
        fin = inicio + d if d else None
    if solo_fecha and fin is not None:
        fin = fin - timedelta(days=1)  # en ICS el fin de un día completo es exclusivo
        if fin <= inicio:
            fin = None
    local = inicio.astimezone(tz)
    recurrencia = None
    if a.get("RRULE"):
        recurrencia, aviso = _rrule_a_recurrencia(a["RRULE"], local, tz)
        if aviso:
            avisos.append(f"{_desescapar(a.get('SUMMARY', ''))[:60]}: {aviso}")
    excepciones = []
    for v, params in a["excepciones"]:
        try:
            d, _ = _fecha_ics(v, params, tz)
            excepciones.append(d.astimezone(tz).date().isoformat())
        except ValueError:
            continue
    estado = {"CANCELLED": "cancelado", "TENTATIVE": "propuesto"}.get(a.get("STATUS", "").upper(), "confirmado")
    return {
        "externo_id": (a.get("UID") or "").strip()[:300],
        "titulo": _desescapar(a.get("SUMMARY", "")).strip()[:300] or "(sin título)",
        "descripcion": _desescapar(a.get("DESCRIPTION", "")).strip(),
        "lugar": _desescapar(a.get("LOCATION", "")).strip()[:300],
        "enlace": (a.get("URL") or "").strip(),
        "inicio": inicio,
        "fin": fin,
        "todo_el_dia": solo_fecha,
        "recurrencia": recurrencia,
        "excepciones": excepciones,
        "estado": estado,
    }
