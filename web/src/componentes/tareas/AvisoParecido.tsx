/**
 * «Ya existe algo parecido» (2026-10-18, Edison: «al crear con IA, avisar si ya existe algo
 * parecido y dejar abrir lo existente antes de crear»). Una línea con lo que ya está y «Abrir».
 * El criterio vive en el servidor (servicios/tareas_reglas.py::parecido): lo usan la ficha de la
 * tarea y del evento, el alta rápida, el pegado del prompt y el registro desde el chat.
 */
import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import { api } from '@qillqa/tiqsi'
import { horaDe } from './calendario'

export interface Parecido {
  id: number
  titulo: string
  estado?: string
  estado_nombre?: string
  /** Evento: su inicio. */
  inicio?: string
  /** Tarea: su plazo y su responsable. */
  vence_fecha?: string | null
  responsable?: string
}

const dia = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00` : iso).toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' })

export function detalleParecido(p: Parecido): string {
  const partes = [p.estado_nombre]
  if (p.inicio) partes.push(`${dia(p.inicio)} ${horaDe(p.inicio)}`)
  if (p.vence_fecha) partes.push(`vence ${dia(p.vence_fecha)}`)
  if (p.responsable) partes.push(p.responsable)
  return partes.filter(Boolean).join(' · ')
}

export default function AvisoParecido({ p, alAbrir }: { p: Parecido | null; alAbrir?: (p: Parecido) => void }) {
  if (!p) return null
  return (
    <Alert
      severity="info"
      sx={{ py: 0, alignItems: 'center' }}
      action={alAbrir && <Button color="inherit" size="small" onClick={() => alAbrir(p)}>Abrir</Button>}
    >
      Ya existe «{p.titulo}»{detalleParecido(p) ? ` (${detalleParecido(p)})` : ''}.
    </Alert>
  )
}

/** Pregunta al servidor (con pausa) si ya hay algo parecido a `cuerpo`; null = no preguntar. */
export function useParecido(ruta: string, cuerpo: Record<string, unknown> | null): Parecido | null {
  const [p, setP] = useState<Parecido | null>(null)
  const turno = useRef(0)
  const clave = cuerpo ? JSON.stringify(cuerpo) : ''
  useEffect(() => {
    if (!clave) return setP(null)
    const mio = ++turno.current
    const t = window.setTimeout(() => {
      api<{ parecido?: Parecido | null; parecida?: Parecido | null }>(ruta, { method: 'POST', body: clave })
        .then((r) => mio === turno.current && setP(r.parecido ?? r.parecida ?? null))
        .catch(() => {})
    }, 450)
    return () => window.clearTimeout(t)
  }, [ruta, clave])
  return clave ? p : null
}
