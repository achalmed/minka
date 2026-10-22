"""Agenda: recurrencia semanal, choques e ICS de ida y vuelta (servicios/agenda_reglas.py)."""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from minka import agenda_reglas as ar

LIMA = ZoneInfo("America/Lima")


def lima(a, m, d, h=0, mi=0):
    return datetime(a, m, d, h, mi, tzinfo=LIMA)


def test_evento_unico_en_la_ventana():
    i = lima(2026, 10, 7, 15)
    assert ar.ocurrencias(i, i + timedelta(hours=2), None, [], lima(2026, 10, 7), lima(2026, 10, 8), LIMA) == [(i, i + timedelta(hours=2))]
    assert ar.ocurrencias(i, None, None, [], lima(2026, 10, 8), lima(2026, 10, 9), LIMA) == []
    # Una excepción en un evento único lo oculta.
    assert ar.ocurrencias(i, None, None, ["2026-10-07"], lima(2026, 10, 7), lima(2026, 10, 8), LIMA) == []


def test_serie_semanal_martes_y_miercoles():
    # Comisión martes y miércoles 15:00–17:00 desde el martes 6, hasta el 21.
    i = lima(2026, 10, 6, 15)
    r = {"frecuencia": "semanal", "dias": [1, 2], "hasta": "2026-10-21"}
    ocs = ar.ocurrencias(i, i + timedelta(hours=2), r, ["2026-10-14"], lima(2026, 10, 1), lima(2026, 11, 30), LIMA)
    fechas = [o[0].date().isoformat() for o in ocs]
    assert fechas == ["2026-10-06", "2026-10-07", "2026-10-13", "2026-10-20", "2026-10-21"]
    assert all(o[0].hour == 15 and o[1] - o[0] == timedelta(hours=2) for o in ocs)


def test_serie_cada_dos_semanas_y_ventana_lejana():
    i = lima(2026, 1, 3, 8)  # sábado: programa de radio
    r = {"frecuencia": "semanal", "intervalo": 2, "dias": [5]}
    ocs = ar.ocurrencias(i, i + timedelta(hours=1), r, [], lima(2026, 10, 1), lima(2026, 11, 1), LIMA)
    fechas = [o[0].date() for o in ocs]
    assert fechas and all((f - date(2026, 1, 3)).days % 14 == 0 for f in fechas)
    assert all(lima(2026, 10, 1) <= o[0] < lima(2026, 11, 1) for o in ocs)


def test_serie_sin_dias_usa_el_dia_de_inicio_y_diaria():
    i = lima(2026, 10, 6, 9)
    ocs = ar.ocurrencias(i, None, {"frecuencia": "semanal"}, [], lima(2026, 10, 1), lima(2026, 10, 25), LIMA)
    assert [o[0].day for o in ocs] == [6, 13, 20]
    ocs = ar.ocurrencias(i, None, {"frecuencia": "diaria", "hasta": "2026-10-09"}, [], lima(2026, 10, 1), lima(2026, 10, 25), LIMA)
    assert [o[0].day for o in ocs] == [6, 7, 8, 9]
    assert ar.limpiar_recurrencia({"frecuencia": "mensual"}) is None


def oc(clave, id_, ini, fin, tipo="otro", part=(), estado="confirmado", dia=False):
    return {"clave": clave, "id": id_, "titulo": clave, "tipo": tipo, "estado": estado, "inicio": ini, "fin": fin,
            "todo_el_dia": dia, "participantes": set(part)}


def test_choques():
    a = oc("educacion", 1, lima(2026, 10, 7, 15), lima(2026, 10, 7, 17), "comision")
    b = oc("trabajo", 2, lima(2026, 10, 7, 15), lima(2026, 10, 7, 18), "comision")
    c = oc("reunion", 3, lima(2026, 10, 7, 17), lima(2026, 10, 7, 19), "despacho", part={"u:1"})
    d = oc("bancada", 4, lima(2026, 10, 7, 18), None, "externa", part={"u:1"})
    e = oc("suspendida", 5, lima(2026, 10, 7, 15), lima(2026, 10, 7, 16), estado="suspendido")
    f = oc("sr", 6, lima(2026, 10, 7), lima(2026, 10, 8), dia=True)
    cruces = ar.choques([a, b, c, d, e, f])
    pares = {(x["a"], x["b"]): x for x in cruces}
    assert pares[("educacion", "trabajo")]["gravedad"] == "alta"  # dos comisiones a la vez
    assert pares[("trabajo", "reunion")]["gravedad"] == "media"  # 17–18 se superponen, sin nadie en común
    assert pares[("reunion", "bancada")]["comparten"] == ["u:1"]
    assert ("educacion", "reunion") not in pares  # una termina cuando empieza la otra
    assert not any("suspendida" in k or "sr" in k for k in pares)


def test_ics_ida_y_vuelta():
    ahora = datetime(2026, 10, 6, 12, tzinfo=timezone.utc)
    eventos = [
        {"uid": "evento-1", "titulo": "Sesión de comisión; agenda, PL", "descripcion": "Línea 1\nLínea 2",
         "lugar": "Sala 2", "enlace": "", "inicio": lima(2026, 10, 7, 15), "fin": lima(2026, 10, 7, 17),
         "todo_el_dia": False, "recurrencia": {"frecuencia": "semanal", "dias": [2], "hasta": "2026-12-16"},
         "excepciones": ["2026-10-14"], "estado": "confirmado", "tipo": "comision"},
        {"uid": "evento-2", "titulo": "Semana de representación " + "x" * 80, "inicio": lima(2026, 10, 19), "fin": lima(2026, 10, 23),
         "todo_el_dia": True, "estado": "propuesto"},
    ]
    texto = ar.exportar_ics(eventos, "Agenda", LIMA, ahora)
    assert texto.startswith("BEGIN:VCALENDAR\r\n") and texto.endswith("END:VCALENDAR\r\n")
    assert "DTSTART:20261007T200000Z" in texto  # 15:00 de Lima en UTC
    assert "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=WE;WKST=MO;UNTIL=20261217T045959Z" in texto
    assert "EXDATE:20261014T200000Z" in texto
    assert r"SUMMARY:Sesión de comisión\; agenda\, PL" in texto
    assert "DTSTART;VALUE=DATE:20261019" in texto and "DTEND;VALUE=DATE:20261024" in texto
    assert "STATUS:TENTATIVE" in texto
    assert all(len(linea.encode()) <= 75 for linea in texto.split("\r\n"))

    vuelta, avisos = ar.importar_ics(texto, LIMA)
    assert avisos == []
    uno, dos = vuelta
    assert uno["externo_id"] == "evento-1@qillqa"
    assert uno["titulo"] == "Sesión de comisión; agenda, PL" and uno["descripcion"] == "Línea 1\nLínea 2"
    assert uno["inicio"] == lima(2026, 10, 7, 15) and uno["fin"] == lima(2026, 10, 7, 17)
    assert uno["recurrencia"] == {"frecuencia": "semanal", "intervalo": 1, "dias": [2], "hasta": "2026-12-16"}
    assert uno["excepciones"] == ["2026-10-14"]
    assert dos["todo_el_dia"] and dos["inicio"].date() == date(2026, 10, 19) and dos["fin"].date() == date(2026, 10, 23)
    assert dos["titulo"].endswith("x" * 80) and dos["estado"] == "propuesto"


def test_ics_de_otros_calendarios():
    texto = (
        "BEGIN:VCALENDAR\r\nBEGIN:VTIMEZONE\r\nTZID:America/Lima\r\nEND:VTIMEZONE\r\n"
        "BEGIN:VEVENT\r\nUID:abc\r\nDTSTART;TZID=America/Lima:20261008T090000\r\nDURATION:PT1H30M\r\n"
        "SUMMARY:Mesa de trabajo\r\nLOCATION:Auditorio\\, piso 2\r\nRRULE:FREQ=WEEKLY;COUNT=4;BYDAY=TH\r\n"
        "BEGIN:VALARM\r\nTRIGGER:-PT15M\r\nSUMMARY:no es el título\r\nEND:VALARM\r\nEND:VEVENT\r\n"
        "BEGIN:VEVENT\r\nUID:men\r\nDTSTART:20261101T150000Z\r\nSUMMARY:Mensual\r\nRRULE:FREQ=MONTHLY\r\nEND:VEVENT\r\n"
        "BEGIN:VEVENT\r\nSUMMARY:Sin fecha\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
    )
    eventos, avisos = ar.importar_ics(texto, LIMA)
    assert len(eventos) == 2 and len(avisos) == 2
    mesa = eventos[0]
    assert mesa["titulo"] == "Mesa de trabajo" and mesa["lugar"] == "Auditorio, piso 2"
    assert mesa["fin"] - mesa["inicio"] == timedelta(minutes=90)
    assert mesa["recurrencia"]["dias"] == [3] and mesa["recurrencia"]["hasta"] == "2026-11-04"
    assert eventos[1]["recurrencia"] is None


# --- feriados del Perú (servicios/feriados.py) ----------------------------------------------



# --- por confirmar (2026-10-18) ------------------------------------------------------------


def test_solicitud_fuera_del_calendario():
    assert ar.ESTADOS["propuesto"] == "Por confirmar"
    assert not ar.en_calendario("propuesto") and not ar.en_calendario("descartado")
    assert ar.en_calendario("confirmado") and ar.en_calendario("cancelado") and ar.en_calendario(None)
    # Al chat solo va lo confirmado.
    assert ar.anunciable("confirmado") and ar.anunciable("realizado")
    assert not any(ar.anunciable(e) for e in ("propuesto", "descartado", "cancelado", "suspendido"))


def test_estado_de_lo_pegado():
    assert ar.estado_de_pegado("Confirmar a la secretaría de la comisión hasta el viernes") == "propuesto"
    assert ar.estado_de_pegado("") == "confirmado" and ar.estado_de_pegado(None) == "confirmado"


def test_programacion_sin_lo_por_confirmar():
    from minka import programacion

    ocs = [{"titulo": "Pleno", "inicio": "2026-10-19T09:00:00-05:00", "estado": "confirmado"},
           {"titulo": "Reunión con el gremio", "inicio": "2026-10-19T10:00:00-05:00", "estado": "propuesto"},
           {"titulo": "Visita", "inicio": "2026-10-19T11:00:00-05:00", "estado": "descartado"}]
    n, texto = programacion.resumen(ocs)
    assert n == 1 and "gremio" not in texto
    assert [a["titulo"] for a in programacion.actividades(ocs)] == ["Pleno"]
