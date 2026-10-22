"""Cuadrante de la matriz de Eisenhower (servicios/tareas_reglas.py::cuadrante)."""
from datetime import datetime, timedelta, timezone

from minka.tareas_reglas import cuadrante

AHORA = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)


def test_cuadrantes():
    pronto = AHORA + timedelta(days=1)
    lejos = AHORA + timedelta(days=10)
    assert cuadrante(pronto, "normal", True, AHORA) == "hacer"
    assert cuadrante(lejos, "normal", True, AHORA) == "planificar"
    assert cuadrante(pronto, "normal", False, AHORA) == "delegar"
    assert cuadrante(None, "normal", False, AHORA) == "despues"
    # La prioridad también cuenta: alta = importante; urgente = urgente.
    assert cuadrante(None, "alta", False, AHORA) == "planificar"
    assert cuadrante(None, "urgente", False, AHORA) == "delegar"
    # Lo vencido es urgente.
    assert cuadrante(AHORA - timedelta(days=3), "normal", True, AHORA) == "hacer"
