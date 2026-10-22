/**
 * Lecturas compartidas del módulo Tareas y Agenda: las opciones (estados, cuentas,
 * listas, plantillas) se piden una vez por página y se comparten entre los diálogos.
 * Un cambio (crear, mover, cerrar) avisa con el evento `qillqa:tareas` para que la
 * tarjeta del Inicio, la lista y el tablero vuelvan a leer sin recargar.
 */
import { useEffect, useState } from 'react'
import { api } from '@qillqa/tiqsi'
import { fichaRecibido } from './apoyo'
import type { OpcionesAgenda, OpcionesTareas, Tarea } from './tipos'

// Las tareas de la última lista leída (2026-10-18): sin servidor, abrir una tarea que nunca se
// abrió en este equipo muestra lo que la lista ya sabe de ella, en vez de un formulario vacío.
const vistas = new Map<number, Tarea>()
export const recordarTareas = (ts: Tarea[]): void => ts.forEach((t) => vistas.set(t.id, t))
export const tareaVista = (id: number): Tarea | undefined => vistas.get(id)

export const EVENTO_TAREAS = 'qillqa:tareas'
export const avisarCambio = () => window.dispatchEvent(new Event(EVENTO_TAREAS))

let opcionesTareas: Promise<OpcionesTareas> | null = null
let opcionesAgenda: Promise<OpcionesAgenda> | null = null

export const olvidarOpciones = () => {
  opcionesTareas = null
}

export function useOpcionesTareas(): OpcionesTareas | null {
  const [o, setO] = useState<OpcionesTareas | null>(null)
  useEffect(() => {
    const leer = () => {
      opcionesTareas ??= api<OpcionesTareas>('/api/tareas/opciones')
      opcionesTareas.then(setO).catch(() => {
        opcionesTareas = null
      })
    }
    leer()
    // Tras `olvidarOpciones()` (lista nueva, etiqueta nueva) se vuelven a pedir.
    const alCambiar = () => leer()
    window.addEventListener(EVENTO_TAREAS, alCambiar)
    return () => window.removeEventListener(EVENTO_TAREAS, alCambiar)
  }, [])
  return o
}

export function useOpcionesAgenda(): OpcionesAgenda | null {
  const [o, setO] = useState<OpcionesAgenda | null>(null)
  useEffect(() => {
    opcionesAgenda ??= api<OpcionesAgenda>('/api/agenda/opciones')
    opcionesAgenda.then(setO).catch(() => {
      opcionesAgenda = null
    })
  }, [])
  return o
}

/** Vuelve a ejecutar `leer` cada vez que algo del módulo cambia. */
export function useAlCambiar(leer: () => void): void {
  useEffect(() => {
    window.addEventListener(EVENTO_TAREAS, leer)
    return () => window.removeEventListener(EVENTO_TAREAS, leer)
  }, [leer])
}

/** Mensaje legible de un error de la API. */
export const mensajeError = (e: unknown): string => (e instanceof Error ? e.message : 'No se pudo completar la acción.')

/**
 * Vínculo y título sugerido para una tarea o un evento que nace de un documento RECIBIDO
 * (Bandeja de entrada: `/tareas?nueva=1&entrada=<id>`, `/agenda?nuevo=1&entrada=<id>`).
 * Se lee la ficha del recibido al anfitrión («recibidos.ficha»); si no se puede, queda el vínculo.
 */
export async function vinculoDeEntrada(id: number): Promise<{ vinculo: { id: string; texto: string }; asunto: string }> {
  const e = await fichaRecibido(id)
  if (!e) return { vinculo: { id: `entrada:${id}`, texto: `Recibido ${id}` }, asunto: '' }
  const nombre = e.documento || e.nombre_original || `Recibido ${id}`
  return { vinculo: { id: `entrada:${id}`, texto: `Recibido: ${nombre}` }, asunto: (e.asunto ?? '').trim() }
}
