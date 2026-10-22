"""La configuración PROPIA de Tareas y Agenda (proyecto Minka; fase 10.2b de docs/plataforma/propuesta-repositorios.md,
2026-10-20). Lee las mismas variables que Qillqa (DATABASE_URL, ZONA_HORARIA) más la suya, MINKA_DATABASE_URL (vacía:
la base documental, como hasta hoy). No depende de `app.config`: viaja con el módulo.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings


class ConfigMinka(BaseSettings):
    database_url: str = "postgresql+asyncpg://qillqa:qillqa@db:5432/qillqa"
    minka_database_url: str = ""
    zona_horaria: str = "America/Lima"
    # Cuando corre SOLA (minka/sola.py): su carpeta (las cuentas del anfitrión mínimo) y la firma de las sesiones.
    minka_dir: str = ""
    jwt_secret: str = ""


config = ConfigMinka()


def url_base() -> str:
    """La URL de su base: MINKA_DATABASE_URL o, mientras no se separe, la documental."""
    return config.minka_database_url or config.database_url
