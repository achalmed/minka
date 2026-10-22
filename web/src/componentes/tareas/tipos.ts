/**
 * Tipos y colores del módulo Tareas y Agenda (2026-10-06). Los datos los da la API
 * (`/api/tareas`, `/api/agenda`); los colores salen de la paleta común (paleta.ts).
 * Desde el 2026-10-19 (rediseño tipo macOS) cada tipo de evento es una tarjeta pastel
 * desaturada —crema, piedra, salvia, taupe, arena— con la hora en un tono oscuro del
 * mismo matiz, como la agenda de referencia; sin colores vivos. En la apariencia oscura
 * (el modo del anfitrión) los pasteles son los mismos matices apagados sobre #1E1E20 y la hora
 * sube de luz, como en la referencia de Edison. La paleta y el modo son del anfitrión (Tiqsi web,
 * fase 10.2b M4): se leen AL USARLOS, porque Qillqa importa esto antes de activar su anfitrión.
 */
import { PALETA, modo } from '@qillqa/tiqsi'

/** Un registro de colores que se lee al usarlo (`COLOR_TIPO.pleno`); lo que no está, `undefined`. */
function alUsar<K extends string>(claves: readonly K[], valor: (k: K) => string): Record<K, string> {
  const hay = (k: string | symbol): k is K => typeof k === 'string' && (claves as readonly string[]).includes(k)
  return new Proxy({} as Record<K, string>, {
    get: (_t, k) => (hay(k) ? valor(k) : undefined),
    has: (_t, k) => hay(k),
    ownKeys: () => [...claves],
    getOwnPropertyDescriptor: (_t, k) => (hay(k) ? { enumerable: true, configurable: true, value: valor(k) } : undefined),
  })
}

export type EstadoTarea = 'por_hacer' | 'en_curso' | 'en_espera' | 'hecha' | 'cancelada'
export type Prioridad = 'baja' | 'normal' | 'alta' | 'urgente'

export interface Vinculo {
  id: string
  texto: string
}

export interface PuntoLista {
  id: string
  texto: string
  hecha: boolean
}

export interface Tarea {
  id: number
  titulo: string
  descripcion: string
  estado: EstadoTarea
  prioridad: Prioridad
  responsable_id: number | null
  responsable: string
  vence_en: string | null
  vence_fecha: string | null
  vence_hora: string | null
  con_hora: boolean
  vencida: boolean
  lista_id: number | null
  lista: string
  lista_color: string
  orden: number
  etiquetas: string[]
  checklist: PuntoLista[]
  plantilla: string
  /** interna (trámite del despacho) o externa (reunión, audiencia…); la calcula el servidor. */
  clase?: 'interna' | 'externa'
  /** La que eligió una persona ('' = la del sistema). */
  clase_elegida?: '' | 'interna' | 'externa'
  entregable: string
  entregable_texto: string
  vinculos: Vinculo[]
  origen: string
  /** Matriz de Eisenhower: lo marca una persona; el cuadrante lo calcula el servidor. */
  importante?: boolean
  cuadrante?: Cuadrante
  version: number
  creado_por: number | null
  creado_por_nombre: string
  creado_en: string | null
  cerrada_en: string | null
  comentarios?: Comentario[]
}

export interface Comentario {
  id: number
  texto: string
  sistema: boolean
  usuario: string
  usuario_id: number | null
  creado_en: string | null
}

export interface UsuarioOpcion {
  id: number
  usuario: string
  nombre: string
  rol: string
  cargo: string
}

export interface ListaTareas {
  id: number
  nombre: string
  color: string
  archivada: boolean
  descripcion: string
}

export interface Plantilla {
  clave: string
  nombre: string
  descripcion: string
  referencia: string
  pasos: { texto: string; dias: number }[]
}

export interface OpcionesTareas {
  estados: { clave: EstadoTarea; nombre: string }[]
  prioridades: { clave: Prioridad; nombre: string }[]
  plantillas: Plantilla[]
  usuarios: UsuarioOpcion[]
  listas: ListaTareas[]
  etiquetas: string[]
  yo: number
  puede_escribir: boolean
}

export interface Participante {
  id?: number
  usuario_id: number | null
  persona_id: number | null
  nombre: string
  rol: string
  confirmado: boolean
  clave?: string
}

export interface Recurrencia {
  frecuencia: 'semanal' | 'diaria'
  intervalo?: number
  dias?: number[]
  hasta?: string | null
}

export interface EventoAgenda {
  id: number
  titulo: string
  descripcion: string
  tipo: string
  estado: string
  inicio: string
  fin: string | null
  todo_el_dia: boolean
  lugar: string
  modalidad: string
  enlace: string
  recurrencia: Recurrencia | null
  excepciones: string[]
  responsable_id: number | null
  responsable: string
  participantes: Participante[]
  vinculos: Vinculo[]
  origen: string
  version: number
  creado_por: number | null
  /** Autoría (2026-10-18): la ficha la dice en una línea tenue. */
  creado_por_nombre?: string
  creado_en?: string | null
  actualizado_por?: number | null
  actualizado_por_nombre?: string
  actualizado_en?: string | null
  /** Solo en `/api/agenda/por-confirmar`: la fecha ya pasó y lo que ya ocupa esa hora. */
  pasado?: boolean
  choques?: { clave: string; titulo: string; desde: string; hasta: string; gravedad: string; comparten: string[] }[]
  /** Solo en las ocurrencias de `/api/agenda/eventos`. */
  clave?: string
  ocurrencia?: string
  serie_inicio?: string
  choque?: boolean
  /** Minutos antes del inicio; null = por omisión del tipo; 0 = sin recordatorio. */
  recordatorio_minutos?: number | null
}

export interface Choque {
  a: string
  b: string
  titulo_a: string
  titulo_b: string
  desde: string
  hasta: string
  comparten: string[]
  gravedad: 'alta' | 'media'
}

export interface OpcionesAgenda {
  tipos: { clave: string; nombre: string }[]
  estados: { clave: string; nombre: string }[]
  modalidades: { clave: string; nombre: string }[]
  roles: { clave: string; nombre: string }[]
  usuarios: UsuarioOpcion[]
  zona_horaria: string
  yo: number
  puede_escribir: boolean
}

export const ESTADOS_TAREA: { clave: EstadoTarea; nombre: string; color: string }[] = [
  { clave: 'por_hacer', nombre: 'Por hacer', get color() { return PALETA.borrador } },
  { clave: 'en_curso', nombre: 'En curso', get color() { return PALETA.enRevision } },
  { clave: 'en_espera', nombre: 'En espera', get color() { return PALETA.aviso } },
  { clave: 'hecha', nombre: 'Hecha', get color() { return PALETA.exito } },
  { clave: 'cancelada', nombre: 'Cancelada', get color() { return PALETA.apagado } },
]
export const COLOR_ESTADO = alUsar(ESTADOS_TAREA.map((e) => e.clave), (k) => ESTADOS_TAREA.find((e) => e.clave === k)!.color)
export const NOMBRE_ESTADO = Object.fromEntries(ESTADOS_TAREA.map((e) => [e.clave, e.nombre])) as Record<EstadoTarea, string>

export const PRIORIDADES: { clave: Prioridad; nombre: string; color: string }[] = [
  { clave: 'urgente', nombre: 'Urgente', get color() { return PALETA.error } },
  { clave: 'alta', nombre: 'Alta', get color() { return PALETA.guinda } },
  { clave: 'normal', nombre: 'Normal', get color() { return PALETA.apagado } },
  { clave: 'baja', nombre: 'Baja', get color() { return PALETA.bordeFuerte } },
]
export const COLOR_PRIORIDAD = alUsar(PRIORIDADES.map((p) => p.clave), (k) => PRIORIDADES.find((p) => p.clave === k)!.color)

/** El tono de cada tipo de evento (la hora, el punto, la leyenda): oscuro y apagado, legible sobre blanco. */
const COLOR_TIPO_CLARO: Record<string, string> = {
  pleno: '#8A6F4E', // crema
  comision: '#5E6B7A', // piedra
  despacho: '#5F7362', // salvia
  externa: '#7D6A60', // taupe
  semana_representacion: '#8F7038', // arena
  medio: '#5D5D62', // gris
  otro: '#6F6F74',
}
/** En la oscura, el mismo matiz subido de luz: legible sobre el pastel apagado y sobre el fondo. */
const COLOR_TIPO_OSCURO: Record<string, string> = {
  pleno: '#D6B88E',
  comision: '#AEBBCB',
  despacho: '#A9C4AD',
  externa: '#CDB4A6',
  semana_representacion: '#D9B872',
  medio: '#B8B8BD',
  otro: '#B0B0B5',
}

/** El fondo pastel de cada tipo (bloques del día y la semana, chips del tipo): el texto va en tinta. */
const FONDO_TIPO_CLARO: Record<string, string> = {
  pleno: '#EFE7D8',
  comision: '#E4E7EC',
  despacho: '#E5EAE3',
  externa: '#EBE4DE',
  semana_representacion: '#EEE3CC',
  medio: '#E6E6E8',
  otro: '#ECECEE',
}
/** Crema, piedra, salvia, taupe y arena apagados sobre #1E1E20 (la tarjeta de la referencia oscura). */
const FONDO_TIPO_OSCURO: Record<string, string> = {
  pleno: '#3D372C',
  comision: '#32363C',
  despacho: '#303932',
  externa: '#3A3430',
  semana_representacion: '#3F3828',
  medio: '#333335',
  otro: '#36363A',
}

export const COLOR_TIPO: Record<string, string> = alUsar(Object.keys(COLOR_TIPO_CLARO),
  (k) => (modo() === 'oscuro' ? COLOR_TIPO_OSCURO : COLOR_TIPO_CLARO)[k])
export const FONDO_TIPO: Record<string, string> = alUsar(Object.keys(FONDO_TIPO_CLARO),
  (k) => (modo() === 'oscuro' ? FONDO_TIPO_OSCURO : FONDO_TIPO_CLARO)[k])

export const NOMBRE_TIPO: Record<string, string> = {
  pleno: 'Pleno',
  comision: 'Comisión',
  despacho: 'Reunión en el despacho',
  externa: 'Reunión o evento externo',
  semana_representacion: 'Semana de representación',
  medio: 'Medio o entrevista',
  otro: 'Otro',
}

/** Evento para mostrar con la sesión de quien mira (el rol invitado solo lee). */
export const puedeEscribir = () => localStorage.getItem('qillqa_rol') !== 'invitado'

/** Feriado, día no laborable o fecha cívica del Perú (`GET /api/agenda/feriados`). */
export interface Feriado {
  fecha: string
  nombre: string
  tipo: 'feriado' | 'no_laborable' | 'civica'
}

export type Cuadrante = 'hacer' | 'planificar' | 'delegar' | 'despues'

/** Misma regla que servicios/tareas_reglas.py::cuadrante (para mover sin esperar al servidor). */
export function cuadranteDe(t: Pick<Tarea, 'vence_en' | 'prioridad' | 'importante'>, ahora = Date.now()): Cuadrante {
  const urgente = t.prioridad === 'urgente' || (t.vence_en !== null && new Date(t.vence_en).getTime() <= ahora + 2 * 864e5)
  const importante = Boolean(t.importante) || t.prioridad === 'alta'
  return urgente && importante ? 'hacer' : importante ? 'planificar' : urgente ? 'delegar' : 'despues'
}
