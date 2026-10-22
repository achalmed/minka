"""Agenda detectada en los documentos (servicios/agenda_detectada.py, 2026-10-08). Pruebas puras."""

import sys
from datetime import date, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from minka.agenda_detectada import detectar, tipo_de  # noqa: E402

DOC = date(2026, 10, 8)


def _uno(texto):
    r = detectar(texto, DOC)
    assert len(r) == 1, r
    return r[0]


def test_oficio_127():
    d = _uno("Solicito facilitar un salón para llevar a cabo una reunión de trabajo el sábado 10 de octubre de 2026, "
             "a las 12:00 m., con la participación del equipo de este despacho parlamentario.")
    assert (d.nombre, d.fecha, d.hora) == ("Reunión de trabajo", date(2026, 10, 10), time(12, 0))


def test_rango_y_sin_anio():
    d = _uno("Se convoca a la mesa técnica el 15 de noviembre, de 9:00 a 11:30 horas, en el GORE.")
    assert (d.fecha, d.hora, d.hora_fin) == (date(2026, 11, 15), time(9, 0), time(11, 30))


def test_relativa_y_tarde():
    d = _uno("La sesión descentralizada será este viernes a las 3 p. m. en Huanta.")
    assert (d.fecha, d.hora) == (date(2026, 10, 9), time(15, 0))


def test_fecha_numerica_y_manana():
    d = _uno("Invitación a la ceremonia del 20/10/2026 a las 10 de la mañana.")
    assert (d.fecha, d.hora) == (date(2026, 10, 20), time(10, 0))


def test_sin_evento_o_en_el_pasado_no_se_agenda():
    assert detectar("Conforme al artículo 96 de la Constitución, solicito información del 10 de octubre de 2025.", DOC) == []
    assert detectar("Se realizó una reunión el 2 de octubre de 2026 con 20 participantes.", DOC) == []
    assert detectar("Remito el informe del 15 de noviembre de 2026.", DOC) == []


def test_de_mas_numero_no_es_hora():
    d = _uno("Habrá una reunión el 12 de octubre de 2026 de 2 representantes por instituto.")
    assert d.hora is None


def test_tipo():
    assert tipo_de("sesión de la Comisión de Educación") == "comision"
    assert tipo_de("reunión en el despacho") == "despacho"
    assert tipo_de("visita al hospital") == "externa"


def test_mayusculas_y_mismo_dia_con_y_sin_hora():
    texto = "Solicito AUDIENCIA para el lunes 14 de diciembre de 2026.\nLa AUDIENCIA será el 14 de diciembre de 2026 a las 9:00 a. m."
    d = _uno(texto)
    assert (d.nombre, d.hora) == ("Audiencia", time(9, 0))


# --- Lo vinculado vigente y sin duplicados (2026-10-12) ---------------------------------------

from minka.agenda_detectada import (  # noqa: E402
    clave_de,
    es_etiqueta_documento,
    etiqueta_corta,
    origen_de,
    plan_fusion,
    recomponer_descripcion,
    recomponer_titulo,
)


def test_titulo_toma_el_numero_vigente():
    assert recomponer_titulo("Visita de trabajo (Oficio S/N-2026-2027-XX-CD/CRP)", "OF-0128") == "Visita de trabajo (OF-0128)"
    assert recomponer_titulo("Reunión de trabajo (OF-0127)", "OF-0127") == "Reunión de trabajo (OF-0127)"
    assert recomponer_titulo("Evento (Oficio N°0131-2026-2027-XX)", "OF-0132") == "Evento (OF-0132)"


def test_titulo_reescrito_por_una_persona_no_se_toca():
    assert recomponer_titulo("Visita al hospital (con el alcalde)", "OF-0128") == "Visita al hospital (con el alcalde)"
    assert recomponer_titulo("Visita al hospital", "OF-0128") == "Visita al hospital"
    assert recomponer_titulo("Visita (OF-0001)", "") == "Visita (OF-0001)"


def test_etiquetas():
    assert etiqueta_corta("OF", 128, "Oficio N°0128-…") == "OF-0128"
    assert etiqueta_corta("OF", None, "Oficio S/N-2026") == "Oficio S/N-2026"
    assert es_etiqueta_documento("OF-0128") and es_etiqueta_documento("Oficio S/N-2026-2027")
    assert not es_etiqueta_documento("con el alcalde")


def test_descripcion():
    d = "Detectado en Oficio S/N-2026: «Visita el 16 de octubre»\nAsunto: viejo\nRevíselo y confírmelo o bórrelo."
    assert recomponer_descripcion(d, "OF-0132").splitlines()[:2] == ["Detectado en OF-0132: «Visita el 16 de octubre»", "Asunto: viejo"]
    assert recomponer_descripcion(d, "OF-0132", "nuevo").splitlines()[1] == "Asunto: nuevo"
    assert recomponer_descripcion("Notas mías", "OF-1") == "Notas mías"


def test_claves():
    assert origen_de("doc:303:2026-10-16T09:00") == "doc:303"
    assert clave_de("doc:303:2026-10-16T09:00") == "2026-10-16T09:00"
    assert origen_de("") == "" and clave_de("x") == ""


def _f(i, origen, clave, nombre="Visita de trabajo (OF-1)", vivo=True, tocado=False, participantes=0):
    return {"id": i, "origen": origen, "clave": clave, "nombre": nombre, "vivo": vivo, "tocado": tocado,
            "participantes": participantes}


def test_fusion_oficio_rehecho():
    """El caso del viernes: el oficio 303 se eliminó y se rehízo como 304; los dos anunciaban la visita."""
    filas = [_f(63, "doc:303", "2026-10-16T09:00", "Visita de trabajo (Oficio S/N-…)", vivo=False),
             _f(64, "doc:304", "2026-10-16T09:00", "Visita de trabajo (OF-0132)")]
    assert plan_fusion(filas) == [(64, [63])]


def test_fusion_mismo_documento_mismo_dia():
    filas = [_f(1, "doc:9", "2026-10-16T09:00"), _f(2, "doc:9", "2026-10-16T09:30", tocado=True, participantes=2)]
    assert plan_fusion(filas) == [(2, [1])]


def test_fusion_dos_invitaciones_a_la_misma_reunion():
    filas = [_f(1, "doc:9", "2026-10-16T10:00", "Reunión (OF-1)"), _f(2, "doc:10", "2026-10-16T10:00", "Reunión (OF-2)")]
    assert plan_fusion(filas) == [(1, [2])]


def test_no_fusiona_lo_distinto():
    filas = [_f(1, "doc:9", "2026-10-16T10:00", "Reunión (OF-1)"), _f(2, "doc:10", "2026-10-16T10:00", "Ceremonia (OF-2)"),
             _f(3, "doc:11", "2026-10-17T10:00", "Reunión (OF-3)"),
             # Sin hora y de dos documentos vivos: puede ser otra actividad ese día.
             _f(4, "doc:12", "2026-10-18Tdia", "Taller (OF-4)"), _f(5, "doc:13", "2026-10-18Tdia", "Taller (OF-5)")]
    assert plan_fusion(filas) == []
