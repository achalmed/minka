"""Tareas y Agenda SOLA: sin Qillqa y sin la base documental, con el anfitrión mínimo de Tiqsi (proyecto Minka; fase 10.2b de
docs/plataforma/propuesta-repositorios.md, 2026-10-20).

    MINKA_DATABASE_URL=postgresql+asyncpg://…/minka  MINKA_DIR=…  JWT_SECRET=<32 o más caracteres> \\
      .venv/bin/uvicorn minka.sola:app --port 8032

Las cuentas viven en MINKA_CUENTAS (por omisión <MINKA_DIR>/cuentas.json) y se crean con
`python -m tiqsi.minimo cuenta <archivo> <usuario> --rol administrador --nombre …`. Sin el directorio, los documentos,
los recibidos, el pegado, los feriados ni la campana de Qillqa, esas partes no se ofrecen; tareas, listas, comentarios,
agenda, participantes del equipo, recurrencia, recordatorios (a su bandeja) y el calendario ICS funcionan con lo suyo.
"""
from __future__ import annotations

import os
from pathlib import Path

from tiqsi.minimo import crear_app

from minka.config import config
from minka.manifiesto import MANIFIESTO

if not config.minka_database_url:
    raise SystemExit("Tareas y Agenda sola necesita su base: MINKA_DATABASE_URL.")
if not (os.environ.get("MINKA_CUENTAS") or config.minka_dir):
    raise SystemExit("Tareas y Agenda sola necesita dónde guardar sus cuentas: MINKA_CUENTAS o MINKA_DIR.")

app = crear_app([MANIFIESTO], nombre="Tareas y Agenda", secreto=config.jwt_secret,
                cuentas=os.environ.get("MINKA_CUENTAS") or Path(config.minka_dir) / "cuentas.json",
                web=os.environ.get("MINKA_WEB") or None)
