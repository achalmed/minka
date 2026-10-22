/**
 * Lo pequeño que Tareas y Agenda usa y antes tomaba de Qillqa (proyecto Minka; fase 10.2b M4, 2026-10-20): lo puro
 * es suyo (copiado, para no importar nada de la plataforma) y lo que solo tiene el anfitrión lo pide por nombre con
 * `servicio()` de Tiqsi web: buscar personas y referencias, los distritos, la ficha de un recibido, el pegado, la cola
 * sin conexión, el aviso breve. Sola (la cáscara mínima), esos servicios no están y su ayuda no aparece.
 */
import { useEffect, useState } from 'react'
import { ErrorApi, servicio } from '@qillqa/tiqsi'

/** Hoy en AAAA-MM-DD con la hora de aquí (toISOString es la de Greenwich: de noche ya sería mañana). */
export const hoyIso = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** «María Quispe Rojas» → MQ: nombre y primer apellido, no dos nombres. */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  const a = partes[0][0] ?? ''
  const b = partes.length >= 3 ? partes[partes.length - 2][0] : partes[1]?.[0] ?? ''
  return (a + b).toUpperCase()
}

// --- el aviso breve y la cola sin conexión (del anfitrión) -----------------------------------------------------
export const SE_GUARDARA = 'Se guardará cuando vuelva la conexión.'

/** Aviso breve abajo, unos segundos (lo pinta el anfitrión; sin él, nada). */
export const avisoBreve = (texto: string): void => servicio<(t: string) => void>('avisos.breve')?.(texto)

export type TipoCambio = 'comentario' | 'tarea'
/** Lo escrito sin servidor que espera para enviarse (la cola del anfitrión). */
export interface CambioPendiente {
  id: string
  cuerpo: string
}

/** Deja la escritura en la cola del anfitrión para cuando vuelva el servidor. `false` si este no tiene cola (sola):
 *  entonces quien llama muestra el error como cualquier otro. */
export function guardarSinConexion(ruta: string, cuerpo: string, rotulo: string, tipo: TipoCambio): boolean {
  const encolar = servicio<(r: string, c: string, ro: string, t: TipoCambio) => void>('sinconexion.encolar')
  if (!encolar) return false
  encolar(ruta, cuerpo, rotulo, tipo)
  return true
}

export const enEspera = (ruta: string, filtro?: (cuerpo: Record<string, unknown>) => boolean): CambioPendiente[] =>
  servicio<typeof enEspera>('sinconexion.en_espera')?.(ruta, filtro) ?? []

export const alCambiarCola = (fn: () => void): (() => void) =>
  servicio<typeof alCambiarCola>('sinconexion.al_cambiar')?.(fn) ?? (() => {})

export const cuerpoDe = (c: CambioPendiente): Record<string, unknown> =>
  servicio<typeof cuerpoDe>('sinconexion.cuerpo')?.(c) ?? {}

// --- lo que Qillqa sabe y Minka aprovecha ----------------------------------------------------------------------
/** ¿Está encendido el módulo `id` en el anfitrión? Sola, siempre: no hay interruptor. */
export const moduloActivo = (id: string): boolean => servicio<(i: string) => boolean>('modulos.activo')?.(id) ?? true

/** Un distrito del Perú (para los aniversarios en la agenda). */
export interface Distrito {
  id: number
  departamento: string
  provincia: string
  distrito: string
  norma: string
  creacion: string
  observacion: string
  anio: number | null
  mes: number | null
  dia: number | null
}

/** Los distritos del anfitrión (sus aniversarios de creación), o ninguno. */
export const distritos = (): Promise<Distrito[]> =>
  servicio<() => Promise<Distrito[]>>('territorio.distritos')?.().catch(() => []) ?? Promise.resolve([])

/** Personas del directorio del anfitrión que coinciden con `q`, o ninguna. */
export const buscarPersonas = <P,>(q: string, limite = 20): Promise<P[]> =>
  servicio<(q: string, l: number) => Promise<P[]>>('personas.buscar')?.(q, limite).catch(() => []) ?? Promise.resolve([])

/** Lo que se puede vincular (normas, documentos, proyectos…) según lo escrito, o nada. */
export const buscarReferencias = <R,>(q: string, contexto: string): Promise<R[]> =>
  servicio<(q: string, c: string) => Promise<R[]>>('referencias.buscar')?.(q, contexto).catch(() => []) ?? Promise.resolve([])

/** La ficha de un recibido del anfitrión (para nombrar el vínculo), o `null`. */
export const fichaRecibido = (id: number | string): Promise<{ asunto?: string; documento?: string; nombre_original?: string } | null> =>
  servicio<(i: number | string) => Promise<{ asunto?: string; documento?: string; nombre_original?: string }>>('recibidos.ficha')?.(id)
    .catch(() => null) ?? Promise.resolve(null)

/** El texto de un mensaje del chat del anfitrión (`?pegar=<id>` desde «Registrar en …»); sin chat, vacío. */
export const textoDeMensaje = (mid: number | string): Promise<string> =>
  servicio<(m: number | string) => Promise<string>>('chat.texto_de_mensaje')?.(mid) ?? Promise.resolve('')

// --- el pegado ---------------------------------------------------------------------------------------------------
/** Lo que el servidor leyó de un texto pegado (tipo, versión, errores, avisos y dudas de vocabulario). */
export interface LecturaPegado {
  tipo: string
  version: number | null
  titulo: string
  modulo: string
  fuente: 'yaml' | 'rotulos' | ''
  errores: string[]
  avisos: string[]
  /** clave → {valor, opciones}: lo que no casó con el vocabulario. */
  dudas: Record<string, { valor: string; opciones: string[] }>
}

/** El mensaje para la persona cuando el pegado falla (422 `pegado_invalido`): la primera causa, en una frase. */
export function mensajePegado(e: unknown): string {
  const d = e instanceof ErrorApi ? (e.detalle as { codigo?: string; errores?: string[] } | null) : null
  if (d && typeof d === 'object' && d.codigo === 'pegado_invalido') return d.errores?.[0] ?? 'No se reconoció el formato.'
  return e instanceof Error ? e.message : 'No se pudo leer lo pegado.'
}

/** Constancia del pegado aplicado en el anfitrión (un fallo, o no tenerla, no deshace el guardado). */
export async function registrarPegado(datos: {
  tipo: string
  version?: number | null
  fuente?: string
  texto: string
  campos_propuestos: Record<string, unknown>
  campos_aplicados: Record<string, unknown>
  rechazados: string[]
  entidad: string
}): Promise<void> {
  try {
    await servicio<(d: typeof datos) => Promise<void>>('pegado.registrar')?.(datos)
  } catch {
    /* la constancia es secundaria: el registro ya se hizo por el módulo */
  }
}

/** Pausa breve tras «Leer»: «Registrar» aparece donde estaba «Leer» y un doble toque en el celular registraba sin
 *  revisar. `true` durante `ms` milisegundos desde que la vista previa queda lista. */
export function usePausaTrasLeer(listo: boolean, ms = 800): boolean {
  const [pausa, setPausa] = useState(false)
  useEffect(() => {
    if (!listo) return
    setPausa(true)
    const t = window.setTimeout(() => setPausa(false), ms)
    return () => window.clearTimeout(t)
  }, [listo, ms])
  return pausa
}
