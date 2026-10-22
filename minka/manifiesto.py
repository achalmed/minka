"""El manifiesto de Tareas y Agenda (proyecto Minka; fase 10.2b de docs/plataforma/propuesta-repositorios.md, 2026-10-20).

Necesita la identidad. Aprovecha el directorio («personas.v1»: los participantes de fuera del equipo), la lectura de lo
pegado («pegado.v1»), los feriados («calendario.v1») y los nombres de lo vinculado («etiquetas.v1»). Sus tareas de
fondo: los recordatorios de plazo y la programación del día. Lo que cuenta y avisa sale por su bandeja de salida
(servicios/minka_eventos.py); quien lo escucha (Qillqa: reglas y campana) lo recibe del bus.
"""
from __future__ import annotations

from tiqsi import Manifiesto
from tiqsi.bandeja_sql import BandejaSQL

from minka import api_agenda as agenda
from minka import api_tareas as tareas
from minka.modelos import BANDEJA
from minka import contrato as minka_contrato
from minka import db as minka_db
from minka.db import SesionMinka

VERSION = "0.1.0"


async def _preparar_base(_anfitrion) -> None:
    await minka_db.preparar()


async def _recordatorios(_anfitrion) -> None:
    """Recordatorios de plazo en la campana (2026-10-06)."""
    from minka import tareas as svc_tareas

    await svc_tareas.bucle()


async def _programacion(_anfitrion) -> None:
    """Programación del día en el chat (2026-10-13): cada mañana, las actividades de hoy."""
    from minka import programacion

    await programacion.bucle()


MANIFIESTO = Manifiesto(
    id="tareas", nombre="Tareas y Agenda", version=VERSION, contrato="^0.1",
    routers=[tareas.router, agenda.router, agenda.router_ics], prefijos=("/api/tareas", "/api/agenda"),
    necesita=("identidad.v1",), aprovecha=("personas.v1", "pegado.v1", "calendario.v1", "etiquetas.v1", "avisos.v1",
                                              "documentos.v1", "recibidos.v1"),
    al_arrancar=[_preparar_base], tareas=[_recordatorios, _programacion],
    bandeja=BandejaSQL(SesionMinka, BANDEJA),
    ofrece={"vinculos.v1": minka_contrato.VINCULOS_V1, "tareas.v1": minka_contrato.TAREAS_V1,
            "agenda.v1": minka_contrato.AGENDA_V1},
    resolutores={"tarea": minka_contrato.resolver_tarea, "evento": minka_contrato.resolver_evento},
    # Lo que le pasa a Qillqa le llega por el bus, después de su commit (a lo sumo 2 s): Minka pone al día lo suyo.
    eventos={"documento.numerado": [minka_contrato.al_documento], "documento.estado": [minka_contrato.al_documento],
             "documento.eliminado": [minka_contrato.al_eliminado], "proyecto.eliminado": [minka_contrato.al_eliminado],
             "entrada.registrada": [minka_contrato.al_recibido]},
)
