"""Importar el respaldo JSON de Super Productivity (servicios/superproductivity.py)."""
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from minka import superproductivity as sp

LIMA = ZoneInfo("America/Lima")


def respaldo():
    ms = int(datetime(2026, 10, 7, 15, 0, tzinfo=LIMA).timestamp() * 1000)
    return {
        "project": {"ids": ["INBOX_PROJECT", "p1"], "entities": {
            "INBOX_PROJECT": {"id": "INBOX_PROJECT", "title": "Inbox"},
            "p1": {"id": "p1", "title": "Comisiones", "theme": {"primary": "#4E0A18"}},
        }},
        "tag": {"ids": ["TODAY", "t1"], "entities": {
            "TODAY": {"id": "TODAY", "title": "Today"}, "t1": {"id": "t1", "title": "Prensa Radio"}}},
        "task": {"ids": ["a", "b", "c", "s1", "s2", "d"], "entities": {
            "a": {"id": "a", "title": "Revisar agenda", "projectId": "p1", "dueWithTime": ms, "tagIds": ["TODAY", "t1"],
                  "subTaskIds": ["s1", "s2"], "notes": "Ver PL", "timeEstimate": 5400000, "isDone": False},
            "s1": {"id": "s1", "title": "Bajar citación", "parentId": "a", "isDone": True},
            "s2": {"id": "s2", "title": "Leer PL", "parentId": "a", "isDone": False},
            "b": {"id": "b", "title": "Llamar", "projectId": "INBOX_PROJECT", "dueDay": "2026-10-09", "isDone": False},
            "c": {"id": "c", "title": "Hecha", "isDone": True},
            "d": {"id": "d", "title": "  ", "isDone": False},
        }},
        "archiveYoung": {"task": {"ids": ["z"], "entities": {"z": {"id": "z", "title": "Vieja", "isDone": True}}}},
    }


def test_plan_basico():
    p = sp.plan(respaldo(), LIMA)
    assert [x["titulo"] for x in p["tareas"]] == ["Revisar agenda", "Llamar"]
    a, b = p["tareas"]
    assert a["externo_id"] == "sp:a" and a["lista_externo_id"] == "sp:proyecto:p1"
    assert a["vence_en"] == datetime(2026, 10, 7, 15, 0, tzinfo=LIMA) and a["con_hora"]
    assert a["etiquetas"] == ["prensa-radio"]
    assert a["checklist"] == [{"id": "sp1", "texto": "Bajar citación", "hecha": True}, {"id": "sp2", "texto": "Leer PL", "hecha": False}]
    assert "estimado 90 min" in a["descripcion"] and a["descripcion"].startswith("Ver PL")
    assert b["lista_externo_id"] is None and not b["con_hora"] and b["vence_en"].date().isoformat() == "2026-10-09"
    assert p["listas"] == [{"externo_id": "sp:proyecto:p1", "nombre": "Comisiones", "color": "#4E0A18"}]
    assert p["omitidas"] == 2  # la hecha y la sin título


def test_hechas_archivo_y_envoltorio():
    p = sp.plan({"data": respaldo()}, LIMA, incluir_hechas=True, incluir_archivo=True)
    titulos = [x["titulo"] for x in p["tareas"]]
    assert "Hecha" in titulos and "Vieja" in titulos
    assert next(x for x in p["tareas"] if x["titulo"] == "Hecha")["estado"] == "hecha"


def test_formato_no_reconocido():
    with pytest.raises(sp.FormatoNoReconocido):
        sp.plan({"otra": 1}, LIMA)
    with pytest.raises(sp.FormatoNoReconocido):
        sp.plan([1, 2], LIMA)
