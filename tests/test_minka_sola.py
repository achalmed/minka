"""tests/test_minka_sola.py — Tareas y Agenda arranca SOLA, con el anfitrión mínimo de Tiqsi, sin Qillqa ni la base
documental (proyecto Minka; fase 10.2b, 2026-10-20; app/minka_sola.py). Sin base de datos: lo que la necesita se prueba en
vivo contra una vacía (qillqa/scripts/verde.sh sola-minka).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
SECRETO = "k" * 40


def _entorno_limpio(tmp_path) -> dict:
    return {"HOME": os.environ.get("HOME", "/tmp"), "PATH": os.environ.get("PATH", ""),
            "MINKA_DATABASE_URL": "postgresql+asyncpg://nadie:nada@127.0.0.1:1/minka_prueba",
            "MINKA_DIR": str(tmp_path / "minka"), "JWT_SECRET": SECRETO}


def test_sola_no_carga_nada_de_qillqa(tmp_path):
    codigo = ("import sys, json; import minka.sola as m; "
              "print(json.dumps({'ajenos': sorted(x for x in sys.modules if x == 'app' or x.startswith('app.')), "
              "'informe': m.app.state.anfitrion.informe(), 'capacidades': m.app.state.anfitrion.capacidades.ofrecidas()}))")
    r = subprocess.run([sys.executable, "-c", codigo], cwd=RAIZ, env=_entorno_limpio(tmp_path),
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    datos = json.loads(r.stdout.strip().splitlines()[-1])
    assert datos["ajenos"] == []                                    # nada de Qillqa
    assert datos["informe"] == [{"id": "tareas", "nombre": "Tareas y Agenda", "version": "0.1.0"}]
    assert set(datos["capacidades"]) == {"identidad.v1", "vinculos.v1", "tareas.v1", "agenda.v1"}


def test_sola_sin_su_base_no_arranca(tmp_path):
    entorno = {k: v for k, v in _entorno_limpio(tmp_path).items() if k != "MINKA_DATABASE_URL"}
    r = subprocess.run([sys.executable, "-c", "import minka.sola"], cwd=RAIZ, env=entorno,
                       capture_output=True, text=True, timeout=120)
    assert r.returncode != 0 and "MINKA_DATABASE_URL" in r.stderr


def test_sola_atiende_con_su_propia_sesion(tmp_path):
    from fastapi.testclient import TestClient
    from tiqsi import Manifiesto
    from tiqsi.minimo import Cuentas, crear_app

    from minka.manifiesto import MANIFIESTO

    cuentas = tmp_path / "cuentas.json"
    Cuentas(cuentas).crear("ana", "clave-larga-1", "administrador", "Ana Pérez")
    copia = Manifiesto(**{**MANIFIESTO.__dict__, "al_arrancar": [], "tareas": [], "bandeja": None})   # sin base aquí
    c = TestClient(crear_app([copia], nombre="Tareas y Agenda", secreto=SECRETO, cuentas=cuentas))
    assert c.get("/api/health").json()["anfitrion"] == "Tareas y Agenda"
    assert c.get("/api/tareas").status_code == 401
    assert c.post("/api/auth/login", json={"usuario": "ana", "clave": "clave-larga-1"}).json()["token"]
    rutas = {x.path for x in c.app.routes}
    assert {"/api/tareas", "/api/agenda/eventos", "/api/agenda.ics"} <= rutas


def test_sola_nombra_sus_tareas_y_eventos(monkeypatch):
    """Sin «etiquetas.v1» (sola), los vínculos a sus tareas y eventos llevan su título; lo ajeno, su clave."""
    import asyncio

    from minka import tareas as svc

    class Sesion:
        async def execute(self, consulta):
            tabla = consulta.get_final_froms()[0].name
            filas = {"tareas": [(1, "Revisar el informe")], "agenda_eventos": [(4, "Sesión de la comisión")]}[tabla]
            return type("R", (), {"all": lambda self: filas})()

    monkeypatch.setattr(svc, "opcional", lambda nombre: None)
    nombres = asyncio.run(svc.etiquetas_de(Sesion(), {"tarea:1", "evento:4", "doc:7"}))
    assert nombres == {"tarea:1": "Tarea: Revisar el informe", "evento:4": "Evento: Sesión de la comisión"}
    assert asyncio.run(svc.etiquetas_de(Sesion(), set())) == {}
