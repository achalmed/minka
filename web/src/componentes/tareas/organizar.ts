/**
 * Cómo se ordena lo que se ve en Tareas y Agenda (2026-10-18, Edison: «que el tablero no se vea
 * saturado», «Mis tareas abruma», «quién creó y quién modificó cada agenda»). Puro: se prueba en
 * pruebas/organizar.test.ts. La clase (interna o externa) la calcula el servidor
 * (servicios/tareas_reglas.py::clase_tarea); aquí solo se filtra y se agrupa.
 */
import type { EventoAgenda, Tarea } from './tipos'

export type FiltroClase = 'todas' | 'interna' | 'externa'

export const NOMBRE_CLASE: Record<FiltroClase, string> = { todas: 'Todas', interna: 'Internas', externa: 'Externas' }

/** Las que creó solo el trámite del despacho (firmar, subir el cargo, registrar en el STD). */
export const esAutomatica = (t: Pick<Tarea, 'origen'>) => t.origen === 'automatica'

export const claseDe = (t: Pick<Tarea, 'clase' | 'origen'>): 'interna' | 'externa' => t.clase ?? 'interna'

export function filtrarClase<T extends Pick<Tarea, 'clase' | 'origen'>>(tareas: T[], filtro: FiltroClase): T[] {
  return filtro === 'todas' ? tareas : tareas.filter((t) => claseDe(t) === filtro)
}

export function contarClases(tareas: Pick<Tarea, 'clase' | 'origen'>[]): Record<FiltroClase, number> {
  const n = { todas: tareas.length, interna: 0, externa: 0 }
  tareas.forEach((t) => n[claseDe(t)]++)
  return n
}

/** Una columna del tablero: primero lo que escribió una persona (en su orden), después las automáticas. */
export function ordenColumna<T extends Pick<Tarea, 'orden' | 'id' | 'origen'>>(tareas: T[]): T[] {
  return [...tareas].sort((a, b) => Number(esAutomatica(a)) - Number(esAutomatica(b)) || a.orden - b.orden || a.id - b.id)
}

/**
 * Prioritaria: urgente o alta, lo urgente e importante (cuadrante «hacer» de la matriz) o lo que
 * una persona marcó importante. Las automáticas nacen importantes (para la matriz): solo cuentan
 * cuando además apremian, o la pestaña se llenaría con todo el trámite.
 */
export const esPrioritaria = (t: Pick<Tarea, 'prioridad' | 'importante' | 'cuadrante' | 'origen'>) =>
  t.prioridad === 'urgente' || t.prioridad === 'alta' || t.cuadrante === 'hacer' || (Boolean(t.importante) && !esAutomatica(t))

export const estaCerrada = (t: Pick<Tarea, 'estado'>) => t.estado === 'hecha' || t.estado === 'cancelada'

export interface Grupo { clave: string; titulo: string; tareas: Tarea[] }

/**
 * «Mis tareas» en cuatro grupos como mucho: Vencidas, Hoy, Próximas (con fecha) y Sin fecha.
 * Dentro de cada uno, lo prioritario primero; el orden de llegada del servidor decide lo demás.
 */
export function gruposPendientes(tareas: Tarea[], hoy: string): Grupo[] {
  const g: Record<string, Tarea[]> = { vencidas: [], hoy: [], proximas: [], sin_fecha: [] }
  for (const t of tareas) {
    if (estaCerrada(t)) continue
    if (t.vencida) g.vencidas.push(t)
    else if (!t.vence_fecha) g.sin_fecha.push(t)
    else if (t.vence_fecha <= hoy) g.hoy.push(t)
    else g.proximas.push(t)
  }
  const titulos: Record<string, string> = { vencidas: 'Vencidas', hoy: 'Hoy', proximas: 'Próximas', sin_fecha: 'Sin fecha' }
  const primero = (xs: Tarea[]) => [...xs].sort((a, b) => Number(esPrioritaria(b)) - Number(esPrioritaria(a)))
  return Object.entries(g).filter(([, v]) => v.length).map(([clave, v]) => ({ clave, titulo: titulos[clave], tareas: primero(v) }))
}

export type VistaMias = 'pendientes' | 'prioritarias' | 'hechas'

export function resumenMias(tareas: Tarea[]): Record<VistaMias, number> {
  const abiertas = tareas.filter((t) => !estaCerrada(t))
  return { pendientes: abiertas.length, prioritarias: abiertas.filter(esPrioritaria).length, hechas: tareas.filter((t) => t.estado === 'hecha').length }
}

/**
 * La línea tenue de la ficha de un evento: «Creada por Ana · editada por Luis». Sin editor
 * distinto, solo quién la creó; lo detectado en un documento lo dice. Vacía si no se sabe nada.
 */
export function lineaAutoria(e: Pick<EventoAgenda, 'creado_por' | 'creado_por_nombre' | 'actualizado_por' | 'actualizado_por_nombre' | 'origen' | 'version'>): string {
  const partes: string[] = []
  if (e.origen === 'detectado') partes.push('Detectada en un documento')
  else if (e.creado_por_nombre) partes.push(`Creada por ${e.creado_por_nombre}`)
  const editor = e.actualizado_por_nombre
  if (editor && (e.version ?? 1) > 1 && (e.actualizado_por !== e.creado_por || e.origen === 'detectado')) partes.push(`editada por ${editor}`)
  return partes.join(' · ')
}

// --- Mis tareas sin saturar (2026-10-19, Edison: «sigue muy saturado») ---------------------
//
// Lo que crea solo el trámite («Subir el cargo de recepción de Oficio N°0087-… · Solicitud…») llena
// «Sin fecha» con decenas de títulos largos. Se agrupan por paso del trámite y se leen cortos:
// el paso una vez como título del grupo y, en cada fila, solo el número y el asunto.

const PASOS_TRAMITE = ['Firmar y subir el firmado de', 'Enviar por mesa de partes', 'Subir el cargo de recepción de', 'Registrar en el STD']
const NOMBRE_PASO: Record<string, string> = {
  'Firmar y subir el firmado de': 'Firmar y subir el firmado',
  'Enviar por mesa de partes': 'Enviar por mesa de partes',
  'Subir el cargo de recepción de': 'Subir el cargo de recepción',
  'Registrar en el STD': 'Registrar en el STD',
}

export interface TituloCorto { paso: string; documento: string; asunto: string }

/**
 * «Registrar en el STD Oficio N°0156-2026-2027-ABC-CD/CRP · Evaluación urgente…» →
 * {paso: 'Registrar en el STD', documento: 'Oficio N° 0156', asunto: 'Evaluación urgente…'}.
 * Un título que no sigue ese molde vuelve entero en `asunto` con `paso` vacío. Puro.
 */
export function tituloCorto(titulo: string): TituloCorto {
  const paso = PASOS_TRAMITE.find((p) => titulo.startsWith(`${p} `))
  if (!paso) return { paso: '', documento: '', asunto: titulo }
  const resto = titulo.slice(paso.length + 1)
  const [doc, ...asunto] = resto.split(' · ')
  // «Oficio N°0156-2026-2027-ABC-CD/CRP» → «Oficio N° 0156»; «Oficio S/N-…» → «Oficio S/N».
  const m = /^(.+?)\s*(?:N\.?\s?°\s?(\d+)|(S\/N))/i.exec(doc)
  const documento = m ? (m[2] ? `${m[1].trim()} N° ${m[2]}` : `${m[1].trim()} S/N`) : doc.trim()
  return { paso: NOMBRE_PASO[paso] ?? paso, documento, asunto: asunto.join(' · ').trim() }
}

export interface GrupoTramite { paso: string; tareas: Tarea[] }

/** Las automáticas del trámite por paso, en el orden del trámite; las demás, aparte. */
export function separarTramite(tareas: Tarea[]): { propias: Tarea[]; tramite: GrupoTramite[] } {
  const propias: Tarea[] = []
  const porPaso = new Map<string, Tarea[]>()
  for (const t of tareas) {
    const c = esAutomatica(t) ? tituloCorto(t.titulo) : null
    if (!c?.paso) propias.push(t)
    else (porPaso.get(c.paso) ?? porPaso.set(c.paso, []).get(c.paso)!).push(t)
  }
  const orden = PASOS_TRAMITE.map((p) => NOMBRE_PASO[p])
  const tramite = [...porPaso.entries()].sort((a, b) => orden.indexOf(a[0]) - orden.indexOf(b[0])).map(([paso, ts]) => ({ paso, tareas: ts }))
  return { propias, tramite }
}

// --- aviso de cruces breve (2026-10-19, Edison: «la notificación en amarillo es muy grande») --

/** «1 cruce de horario» / «3 cruces de horario»; vacío si no hay. Puro. */
export const textoCruces = (n: number): string => (n <= 0 ? '' : n === 1 ? '1 cruce de horario' : `${n} cruces de horario`)
