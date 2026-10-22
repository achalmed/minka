"""Modelos del módulo TAREAS Y AGENDA (2026-10-06).

Módulo propio de Qillqa, autosuficiente: OpenProject deja de ser la dependencia de la
planificación y queda como espejo opcional (docs/decisiones.md §Tareas y Agenda). Va en su
propio archivo para no tocar `modelos.py` (que comparten todos los módulos): hereda la
misma `Base`, así que `create_all` de main.py crea estas tablas al arrancar con solo
importar este módulo (lo importan api/tareas.py y api/agenda.py).

Los VÍNCULOS de una tarea o un evento con lo demás del sistema (documento, proyecto de ley,
semana SR, persona, institución, foto, pedido) NO tienen tabla propia: son filas de
`relaciones` (modelos.Relacion) con `origen='tarea:N'` o `origen='evento:N'`, `tipo='vinculo'`
y `fuente='manual'`, con el mismo identificador del mapa (`doc:12`, `pl:3`, `sr:2`,
`persona:7`, `inst:4`, `foto:9`, `pedido:5`). Así el mapa y cualquier consulta «qué tareas
tiene este documento» leen una sola tabla.

Fechas: `timestamptz`. Una tarea con plazo SIN hora guarda las 23:59 de ese día en la zona
de la entidad y `con_hora=False` (se muestra solo la fecha).
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from tiqsi.bandeja_sql import tabla_bandeja


class BaseMinka(DeclarativeBase):
    """Las tablas de Tareas y Agenda (proyecto Minka; fase 10.2b, 2026-10-20): su `create_all` es el del módulo
    (servicios/minka_db.py), no el de la base documental. La cuenta y la persona del directorio se guardan como número,
    sin clave foránea hacia Qillqa; las bases que ya las tenían las conservan hasta que la base se separe."""



class ListaTareas(BaseMinka):
    """Una lista (o «proyecto» al modo de Todoist/Super Productivity): agrupa tareas.
    Opcional: una tarea puede no tener lista (bandeja personal)."""

    __tablename__ = "tareas_listas"

    id: Mapped[int] = mapped_column(primary_key=True)
    despacho_id: Mapped[int] = mapped_column(Integer, default=1)
    nombre: Mapped[str] = mapped_column(String(120))
    descripcion: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String(20), default="")
    archivada: Mapped[bool] = mapped_column(default=False)
    # Procedencia de una lista importada (p. ej. `sp:proyecto:<id>`): importar dos veces no duplica.
    externo_id: Mapped[str] = mapped_column(String(160), default="")
    creado_por: Mapped[int | None] = mapped_column(Integer, nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Tarea(BaseMinka):
    __tablename__ = "tareas"

    id: Mapped[int] = mapped_column(primary_key=True)
    despacho_id: Mapped[int] = mapped_column(Integer, default=1)
    titulo: Mapped[str] = mapped_column(Text)
    descripcion: Mapped[str] = mapped_column(Text, default="")
    # por_hacer | en_curso | en_espera | hecha | cancelada (servicios/tareas_reglas.py)
    estado: Mapped[str] = mapped_column(String(20), default="por_hacer", index=True)
    # baja | normal | alta | urgente
    prioridad: Mapped[str] = mapped_column(String(10), default="normal")
    # Matriz de Eisenhower (2026-10-08): lo IMPORTANTE lo marca una persona (o lo es por su
    # prioridad); lo URGENTE sale solo del plazo (servicios/tareas_reglas.py::cuadrante).
    importante: Mapped[bool] = mapped_column(default=False)
    # Responsable ÚNICO (lo que faltaba en el chat del equipo: «agendar», «revisar» sin dueño).
    responsable_id: Mapped[int | None] = mapped_column(
        Integer, nullable=True, index=True
    )
    vence_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    con_hora: Mapped[bool] = mapped_column(default=False)
    lista_id: Mapped[int | None] = mapped_column(
        ForeignKey("tareas_listas.id", ondelete="SET NULL"), nullable=True
    )
    # Orden manual dentro de su columna del tablero o de su lista.
    orden: Mapped[int] = mapped_column(Integer, default=0)
    etiquetas: Mapped[list] = mapped_column(JSONB, default=list)
    # Lista de verificación: [{"id": "a1", "texto": "…", "hecha": false}]
    checklist: Mapped[list] = mapped_column(JSONB, default=list)
    # interna (trámite de la entidad) | externa (reunión, audiencia, compromiso fuera) | "" = la
    # decide el sistema (2026-10-18, servicios/tareas_reglas.py::clase_tarea).
    clase: Mapped[str] = mapped_column(String(10), default="")
    # Plantilla de la que salió (semana_representacion, sesion_comision, proyecto_ley…).
    plantilla: Mapped[str] = mapped_column(String(40), default="")
    # Entregable con que se cerró: identificador del sistema (`doc:12`) o enlace.
    entregable: Mapped[str] = mapped_column(String(300), default="")
    # qillqa | superproductivity | ics — y su id de origen, para importar sin duplicar.
    origen: Mapped[str] = mapped_column(String(30), default="qillqa")
    externo_id: Mapped[str] = mapped_column(String(160), default="", index=True)
    # Control de concurrencia: el PUT trae la versión que leyó (409 si otro guardó antes).
    version: Mapped[int] = mapped_column(Integer, default=1)
    creado_por: Mapped[int | None] = mapped_column(Integer, nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    actualizado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    cerrada_por: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cerrada_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TareaComentario(BaseMinka):
    """Conversación de la tarea (y su bitácora: cambios de estado y de responsable con
    `sistema=True`). Nunca se borra."""

    __tablename__ = "tareas_comentarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    tarea_id: Mapped[int] = mapped_column(ForeignKey("tareas.id", ondelete="CASCADE"), index=True)
    usuario_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    texto: Mapped[str] = mapped_column(Text)
    sistema: Mapped[bool] = mapped_column(default=False)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EventoAgenda(BaseMinka):
    """Un evento de la agenda de la entidad. (La tabla `eventos` es la bitácora de los
    documentos: por eso esta se llama `agenda_eventos`.)"""

    __tablename__ = "agenda_eventos"

    id: Mapped[int] = mapped_column(primary_key=True)
    despacho_id: Mapped[int] = mapped_column(Integer, default=1)
    titulo: Mapped[str] = mapped_column(String(300))
    descripcion: Mapped[str] = mapped_column(Text, default="")
    # pleno | comision | despacho | externa | semana_representacion | medio | otro
    tipo: Mapped[str] = mapped_column(String(30), default="otro")
    # propuesto | confirmado | suspendido | realizado | cancelado | descartado. «propuesto» (por
    # confirmar) y «descartado» son una SOLICITUD: no salen en el calendario (2026-10-18,
    # servicios/agenda_reglas.py::en_calendario).
    estado: Mapped[str] = mapped_column(String(20), default="confirmado")
    inicio: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    fin: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    todo_el_dia: Mapped[bool] = mapped_column(default=False)
    lugar: Mapped[str] = mapped_column(String(300), default="")
    # presencial | virtual | mixta
    modalidad: Mapped[str] = mapped_column(String(20), default="presencial")
    enlace: Mapped[str] = mapped_column(Text, default="")
    # Recurrencia simple: {"frecuencia": "semanal", "intervalo": 1, "dias": [1, 2], "hasta": "2026-12-15"}
    # (días 0 = lunes … 6 = domingo). NULL = evento único.
    recurrencia: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True), nullable=True)
    # Ocurrencias de la serie que no se realizan (fechas ISO de inicio).
    excepciones: Mapped[list] = mapped_column(JSONB, default=list)
    responsable_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    origen: Mapped[str] = mapped_column(String(30), default="qillqa")
    externo_id: Mapped[str] = mapped_column(String(300), default="", index=True)
    # Recordatorio antes de la hora (2026-10-12): minutos; NULL = el valor por omisión del tipo
    # (servicios/tareas.py `MINUTOS_RECORDATORIO`); 0 = sin recordatorio. `recordatorio_avisado_en`
    # evita repetirlo (se vacía al cambiar el inicio).
    recordatorio_minutos: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recordatorio_avisado_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    creado_por: Mapped[int | None] = mapped_column(Integer, nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    actualizado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    # Quién lo cambió por última vez (2026-10-18): la ficha lo dice en una línea tenue.
    actualizado_por: Mapped[int | None] = mapped_column(Integer, nullable=True)


class EventoParticipante(BaseMinka):
    """Quién va (o acompaña): una cuenta del equipo, una persona del directorio o solo
    un nombre escrito."""

    __tablename__ = "agenda_participantes"

    id: Mapped[int] = mapped_column(primary_key=True)
    evento_id: Mapped[int] = mapped_column(ForeignKey("agenda_eventos.id", ondelete="CASCADE"), index=True)
    usuario_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    persona_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    nombre: Mapped[str] = mapped_column(String(200), default="")
    # titular | acompana | responsable | invitado
    rol: Mapped[str] = mapped_column(String(20), default="acompana")
    confirmado: Mapped[bool] = mapped_column(default=False)


class AgendaToken(BaseMinka):
    """Dirección secreta del calendario de una persona (`GET /api/agenda.ics?token=…`): los
    calendarios externos (Google, Outlook, Thunderbird, Super Productivity) no pueden mandar
    la sesión. Solo lectura; se renueva o se revoca desde la Agenda."""

    __tablename__ = "agenda_tokens"
    __table_args__ = (UniqueConstraint("token"),)

    usuario_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token: Mapped[str] = mapped_column(String(80))
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    usado_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)



class AjusteMinka(BaseMinka):
    """Los ajustes del módulo (fase 10.2b, 2026-10-20): hoy, «agenda_descartados» (lo detectado que alguien borró y no
    vuelve a proponerse). Antes vivía en `ajustes` de la plataforma; se copia aquí una vez (servicios/minka_db.py)."""

    __tablename__ = "minka_ajustes"

    clave: Mapped[str] = mapped_column(String(60), primary_key=True)
    valor: Mapped[dict] = mapped_column(JSONB, default=dict)


class VinculoMinka(BaseMinka):
    """Un vínculo de una tarea o un evento con lo que se trabaja (2026-10-06; suyo desde la fase 10.2b, 2026-10-20):
    `origen` es «tarea:N» o «evento:N»; `destino`, la clave de lo vinculado («doc:12», «entrada:3», «evento:8»).
    Antes eran filas de `relaciones` de tipo «vinculo»; se trasladaron con su id (servicios/minka_db.py). Qillqa los lee
    por «vinculos.v1» (servicios/minka_contrato.py)."""

    __tablename__ = "minka_vinculos"
    __table_args__ = (UniqueConstraint("origen", "destino", name="minka_vinculos_unico"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    origen: Mapped[str] = mapped_column(String(80), index=True)
    destino: Mapped[str] = mapped_column(String(120), index=True)
    datos: Mapped[dict] = mapped_column(JSONB, default=dict)
    creado_por: Mapped[int | None] = mapped_column(Integer, nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

# Su bandeja de salida durable (fase 10.2b, 2026-10-20; tiqsi.bandeja): lo que Minka cuenta («tarea.asignada»,
# «evento.creado», «evento.recordatorio», «agenda.programacion_diaria») y los avisos de su campana («aviso.nuevo») entran
# en la MISMA transacción que el cambio; el repartidor del anfitrión los entrega al bus y Qillqa aplica sus reglas y
# enciende la campana (servicios/eventos_sistema.py y notificaciones.py, `desde_bus`), a lo sumo 2 s después.
BANDEJA = tabla_bandeja(BaseMinka.metadata, "minka_bandeja")


class SalidaMinka(BaseMinka):
    """Una fila de la bandeja (para anotarla con `sesion.add`, como un aviso de antes)."""

    __table__ = BANDEJA
