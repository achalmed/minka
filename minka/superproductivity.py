"""Importar el respaldo JSON de Super Productivity (2026-10-06). Parte PURA: lee el archivo y
arma el plan (listas y tareas nuevas); la API (api/tareas.py) lo muestra como vista previa y
solo escribe con `aplicar`. Pruebas: backend/tests/test_superproductivity.py.

Por qué importar y no sincronizar (docs/decisiones.md §Tareas y Agenda, 2026-10-06): Super
Productivity sincroniza por WebDAV, Dropbox, archivo local o su propio servidor con un formato
interno que cambia entre versiones (estado NgRx completo; en las recientes, registro de
operaciones con relojes vectoriales). Escribir en él desde Qillqa arriesga corromper los datos
de la persona. Lo seguro es: traer sus tareas a Qillqa (idempotente, por `externo_id`) y que
Super Productivity LEA la agenda de Qillqa por su integración de calendario (URL ICS).

Formato que se acepta (Ajustes → Sincronización y exportación → Exportar datos):
- el estado completo `{"task": {"ids": [...], "entities": {...}}, "project": …, "tag": …}`;
- envuelto: `{"data": {…}}` (copias de sincronización y versiones nuevas);
- el archivo de tareas archivadas: `taskArchive` (versiones viejas) o `archiveYoung.task` /
  `archiveOld.task` (versiones nuevas).
Una subtarea (`parentId`) pasa a ser un punto de la lista de verificación de su tarea madre.
Plazo: `dueWithTime` (milisegundos, con hora), `dueDay` (AAAA-MM-DD) o `plannedAt` (versiones viejas).
"""

from __future__ import annotations

from datetime import date, datetime, timezone, tzinfo

BANDEJA_SP = ("INBOX", "INBOX_PROJECT")
ETIQUETAS_ESPECIALES = ("TODAY",)


class FormatoNoReconocido(ValueError):
    pass


def _entidades(estado) -> list[dict]:
    """Un estado NgRx ({ids, entities}) o una lista → lista de entidades en su orden."""
    if isinstance(estado, list):
        return [x for x in estado if isinstance(x, dict)]
    if not isinstance(estado, dict):
        return []
    entidades = estado.get("entities")
    if not isinstance(entidades, dict):
        return []
    ids = estado.get("ids") or list(entidades)
    return [entidades[i] for i in ids if isinstance(entidades.get(i), dict)]


def desenvolver(datos) -> dict:
    if not isinstance(datos, dict):
        raise FormatoNoReconocido("El archivo no es un respaldo de Super Productivity (se esperaba un objeto JSON).")
    for _ in range(3):
        if "task" in datos or "taskArchive" in datos or "archiveYoung" in datos:
            return datos
        interno = datos.get("data") or datos.get("mainModelData")
        if not isinstance(interno, dict):
            break
        datos = interno
    raise FormatoNoReconocido("No se encontraron tareas: exporte desde Super Productivity con «Exportar datos» (JSON).")


def _ms_a_fecha(ms, tz: tzinfo) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(ms) / 1000, timezone.utc).astimezone(tz)
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _minutos(ms) -> int:
    try:
        return int(int(ms) / 60000)
    except (TypeError, ValueError):
        return 0


def plan(datos, tz: tzinfo, incluir_hechas: bool = False, incluir_archivo: bool = False) -> dict:
    """{listas: [{externo_id, nombre, color}], tareas: [{externo_id, titulo, descripcion,
    estado, vence_en, con_hora, etiquetas, checklist, lista_externo_id}], omitidas, avisos}."""
    d = desenvolver(datos)
    proyectos = {p.get("id"): p for p in _entidades(d.get("project"))}
    etiquetas = {t.get("id"): t for t in _entidades(d.get("tag"))}
    tareas = _entidades(d.get("task"))
    archivadas: list[dict] = []
    if incluir_archivo:
        archivadas += _entidades(d.get("taskArchive"))
        for clave in ("archiveYoung", "archiveOld"):
            archivadas += _entidades((d.get(clave) or {}).get("task") if isinstance(d.get(clave), dict) else None)
    todas = tareas + [t for t in archivadas if t.get("id") not in {x.get("id") for x in tareas}]
    por_id = {t.get("id"): t for t in todas if t.get("id")}
    avisos: list[str] = []
    omitidas = 0

    salida_tareas: list[dict] = []
    usadas_listas: set[str] = set()
    for t in todas:
        if not t.get("id") or not str(t.get("title") or "").strip():
            omitidas += 1
            continue
        if t.get("parentId"):
            continue  # va como punto de la lista de su tarea madre
        hecha = bool(t.get("isDone"))
        if hecha and not incluir_hechas:
            omitidas += 1
            continue
        vence, con_hora = None, False
        if t.get("dueWithTime"):
            vence, con_hora = _ms_a_fecha(t["dueWithTime"], tz), True
        elif t.get("dueDay"):
            try:
                dia = date.fromisoformat(str(t["dueDay"])[:10])
                vence = datetime(dia.year, dia.month, dia.day, 23, 59, tzinfo=tz)
            except ValueError:
                vence = None
        elif t.get("plannedAt"):
            vence, con_hora = _ms_a_fecha(t["plannedAt"], tz), True
        checklist = []
        for i, sid in enumerate(t.get("subTaskIds") or []):
            s = por_id.get(sid)
            if s and str(s.get("title") or "").strip():
                checklist.append({"id": f"sp{i + 1}", "texto": str(s["title"]).strip()[:500], "hecha": bool(s.get("isDone"))})
        nombres = []
        for tid in t.get("tagIds") or []:
            if tid in ETIQUETAS_ESPECIALES:
                continue
            nombre = str((etiquetas.get(tid) or {}).get("title") or "").strip().lower().replace(" ", "-")
            if nombre:
                nombres.append(nombre[:40])
        descripcion = str(t.get("notes") or "").strip()
        estimado = _minutos(t.get("timeEstimate"))
        dedicado = _minutos(t.get("timeSpent"))
        extra = []
        if estimado:
            extra.append(f"estimado {estimado} min")
        if dedicado:
            extra.append(f"dedicado {dedicado} min")
        if extra:
            descripcion = (descripcion + "\n\n" if descripcion else "") + "Super Productivity: " + ", ".join(extra) + "."
        if t.get("repeatCfgId"):
            avisos.append(f"«{str(t['title'])[:60]}» se repite en Super Productivity: se importa una sola vez.")
        pid = t.get("projectId")
        lista = None
        if pid and pid not in BANDEJA_SP and pid in proyectos:
            lista = f"sp:proyecto:{pid}"
            usadas_listas.add(pid)
        salida_tareas.append({
            "externo_id": f"sp:{t['id']}"[:160],
            "titulo": str(t["title"]).strip()[:1000],
            "descripcion": descripcion,
            "estado": "hecha" if hecha else "por_hacer",
            "vence_en": vence,
            "con_hora": con_hora,
            "etiquetas": nombres[:20],
            "checklist": checklist[:200],
            "lista_externo_id": lista,
        })

    listas = []
    for pid in usadas_listas:
        p = proyectos[pid]
        tema = p.get("theme") if isinstance(p.get("theme"), dict) else {}
        listas.append({
            "externo_id": f"sp:proyecto:{pid}",
            "nombre": str(p.get("title") or "Proyecto de Super Productivity").strip()[:120],
            "color": str(tema.get("primary") or "")[:20],
        })
    listas.sort(key=lambda x: x["nombre"].lower())
    return {"listas": listas, "tareas": salida_tareas, "omitidas": omitidas, "avisos": avisos[:30]}
