"""Tareas: alta rápida en lenguaje natural, plazos, vistas y plantillas (servicios/tareas_reglas.py)."""
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from minka import tareas_reglas as r

LIMA = ZoneInfo("America/Lima")
HOY = date(2026, 10, 6)  # martes
CUENTAS = ["edison", "secretaria", "asesor1", "asesor2"]


def i(texto):
    return r.interpretar(texto, HOY, CUENTAS)


def test_alta_rapida_completa():
    x = i("revisar PL mañana 15:00 @secretaria !alta #comision")
    assert x["titulo"] == "revisar PL"
    assert x["fecha"] == "2026-10-07"
    assert x["hora"] == "15:00"
    assert x["responsable"] == "secretaria"
    assert x["prioridad"] == "alta"
    assert x["etiquetas"] == ["comision"]
    assert x["avisos"] == []


def test_dias_de_la_semana():
    assert i("enviar oficio el viernes")["fecha"] == "2026-10-09"
    assert i("pleno martes")["fecha"] == "2026-10-06"  # hoy es martes: hoy
    assert i("llamar próximo martes")["fecha"] == "2026-10-13"
    assert i("revisar el miercoles")["fecha"] == "2026-10-07"  # sin tilde también
    assert i("x sábado")["fecha"] == "2026-10-10"


def test_fechas_relativas_y_absolutas():
    assert i("firmar pasado mañana")["fecha"] == "2026-10-08"
    assert i("hoy cerrar")["fecha"] == "2026-10-06"
    assert i("en 3 días informe")["fecha"] == "2026-10-09"
    assert i("en 2 semanas rendición")["fecha"] == "2026-10-20"
    assert i("próxima semana viáticos")["fecha"] == "2026-10-12"
    assert i("reunión 7/10")["fecha"] == "2026-10-07"
    assert i("reunión 7/1")["fecha"] == "2027-01-07"  # enero ya pasó: el próximo
    assert i("reunión 2026-11-03")["fecha"] == "2026-11-03"
    x = i("informe para el 15 de noviembre")
    assert (x["fecha"], x["titulo"]) == ("2026-11-15", "informe")
    assert i("algo 1 de setiembre de 2027")["fecha"] == "2027-09-01"


def test_horas():
    assert i("reunión a las 17")["hora"] == "17:00"
    assert i("reunión 3pm")["hora"] == "15:00"
    assert i("reunión 3:30 p.m.")["hora"] == "15:30"
    assert i("salida 5:30 am")["hora"] == "05:30"
    assert i("comisión 15 h")["hora"] == "15:00"
    # Hora sin fecha: hoy.
    assert i("llamar 18:00")["fecha"] == "2026-10-06"


def test_responsable_prioridad_y_avisos():
    assert i("x @EDISON")["responsable"] == "edison"
    assert i("x @sec")["responsable"] == "secretaria"  # inicio único
    ambiguo = i("x @asesor")
    assert ambiguo["responsable"] is None and "varias" in ambiguo["avisos"][0]
    assert "No hay" in i("x @nadie")["avisos"][0]
    assert i("x !urgente")["prioridad"] == "urgente"
    assert i("x !!")["prioridad"] == "alta"
    assert i("x !!!")["prioridad"] == "urgente"
    assert i("x !4")["prioridad"] == "baja"
    assert i("solo título")["prioridad"] is None
    # Un número sin contexto no es una fecha ni una hora.
    x = i("revisar 3 proyectos")
    assert (x["titulo"], x["fecha"], x["hora"]) == ("revisar 3 proyectos", None, None)


def test_plazo_con_y_sin_hora():
    v, con_hora = r.plazo("2026-10-07", "15:00", LIMA)
    assert con_hora and v == datetime(2026, 10, 7, 15, 0, tzinfo=LIMA)
    v, con_hora = r.plazo("2026-10-07", None, LIMA)
    assert not con_hora and (v.hour, v.minute) == (23, 59)
    assert r.plazo(None, None, LIMA) == (None, False)


def test_vencida():
    ahora = datetime(2026, 10, 6, 20, 0, tzinfo=LIMA).astimezone(timezone.utc)
    # Con hora: vence a esa hora.
    assert r.vencida(datetime(2026, 10, 6, 15, 0, tzinfo=LIMA), True, "por_hacer", ahora, LIMA)
    # Sin hora: vence al terminar su día (hoy aún no).
    assert not r.vencida(datetime(2026, 10, 6, 23, 59, tzinfo=LIMA), False, "por_hacer", ahora, LIMA)
    assert r.vencida(datetime(2026, 10, 5, 23, 59, tzinfo=LIMA), False, "en_curso", ahora, LIMA)
    assert not r.vencida(datetime(2026, 10, 5, 23, 59, tzinfo=LIMA), False, "hecha", ahora, LIMA)


def test_rango_de_vistas():
    ahora = datetime(2026, 10, 6, 10, 0, tzinfo=LIMA)
    _, hasta = r.rango_vista("hoy", ahora, LIMA)
    assert hasta.astimezone(LIMA).date() == date(2026, 10, 6)
    _, hasta = r.rango_vista("semana", ahora, LIMA)
    assert hasta.astimezone(LIMA).date() == date(2026, 10, 13)
    assert r.rango_vista("todas", ahora, LIMA) == (None, None)


def test_plantillas_genericas():
    claves = {p["clave"] for p in r.plantillas_publicas()}
    assert {"semana_representacion", "sesion_comision", "proyecto_ley"} <= claves
    lista = r.checklist_de("sesion_comision")
    assert lista[0] == {"id": "p1", "texto": "Descargar la citación y la agenda", "hecha": False}
    pasos = r.pasos_con_fecha("sesion_comision", date(2026, 10, 7))
    assert pasos[0][1] == date(2026, 10, 5) and pasos[-1][1] == date(2026, 10, 8)


def test_limpiezas_y_vinculos():
    assert r.limpiar_etiquetas(["#Comisión", "comisión", " Prensa Radio "]) == ["comisión", "prensa-radio"]
    assert r.limpiar_checklist([{"texto": " a "}, {"texto": ""}, "x", {"texto": "b", "hecha": 1}]) == [
        {"id": "c1", "texto": "a", "hecha": False}, {"id": "c4", "texto": "b", "hecha": True}]
    assert r.vinculo_valido("entrada:4") and r.vinculo_valido("doc:12") and r.vinculo_valido("persona:7") and r.vinculo_valido("pl:3")
    assert not r.vinculo_valido("doc:x") and not r.vinculo_valido("norma:ley-1") and not r.vinculo_valido("doc:1; drop")


def test_alta_rapida_escrita_sin_servidor_usa_el_dia_en_que_se_escribio():
    # Una tarea escrita sin servidor el martes sale de la cola el jueves: «mañana» es el miércoles.
    from minka.api_tareas import dia_de_referencia

    jueves = date(2026, 10, 8)
    assert dia_de_referencia(jueves, HOY) == HOY
    assert r.interpretar("revisar PL mañana", dia_de_referencia(jueves, HOY), CUENTAS)["fecha"] == "2026-10-07"
    assert dia_de_referencia(jueves, None) == jueves
    assert dia_de_referencia(jueves, date(2026, 10, 9)) == jueves  # nunca un día futuro
    assert dia_de_referencia(jueves, date(2026, 8, 1)) == jueves  # ni uno muy viejo


# --- clase y parecidas (2026-10-18) --------------------------------------------------------


def test_clase_interna_o_externa():
    assert r.clase_tarea("Asistir al foro sobre inteligencia artificial") == "externa"
    assert r.clase_tarea("Reunión con el gremio de mototaxistas") == "externa"
    assert r.clase_tarea("Acompañar al diputado a la audiencia") == "externa"
    assert r.clase_tarea("Subir el cargo de recepción del oficio") == "interna"
    # Lo que crea solo el trámite es interno aunque hable de una reunión.
    assert r.clase_tarea("Enviar Oficio N°0063 · Solicito una reunión técnica", origen="automatica") == "interna"
    # Vinculada a un evento de la agenda: externa; lo que elige una persona manda.
    assert r.clase_tarea("Preparar la carpeta", vinculos=["evento:4"]) == "externa"
    assert r.clase_tarea("Reunión con el gremio", clase="interna") == "interna"


def test_parecido_de_titulos():
    assert r.parecido("Reunión con el gremio de mototaxistas de Huanta", "reunion con gremio mototaxistas huanta") >= r.UMBRAL_PARECIDO
    assert r.parecido("Revisar el PL", "Revisar el PL", mismo_dia=True) == 1.25
    # Otro número de oficio: no es la misma tarea.
    assert r.parecido("Firmar y subir el firmado de Oficio N°0149", "Firmar y subir el firmado de Oficio N°0151") == 0.0
    assert r.parecido("Comprar pasajes", "Redactar el informe") < r.UMBRAL_PARECIDO
