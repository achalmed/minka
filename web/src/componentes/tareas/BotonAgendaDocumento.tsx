/**
 * El icono de tareas del visor del documento, con LLAMADA A LA ACCIÓN (Edison 2026-10-08: «al
 * identificar un evento en el documento debería aparecer una notificación en esa partecita, con
 * ese icono; serviría también para confirmar el evento»).
 *
 * Si el documento anuncia una fecha (reunión, visita, audiencia… detectada por
 * servicios/agenda_detectada.py), el icono se marca y late; un clic muestra cada fecha
 * propuesta con «Confirmar» y «Descartar», y sigue ofreciendo «Crear tarea» como antes
 * (BotonCrearTarea). Sin fechas propuestas es el mismo botón de siempre.
 */
import { useCallback, useEffect, useState } from 'react'
import Badge from '@mui/material/Badge'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { keyframes } from '@mui/system'
import AddTaskIcon from '@mui/icons-material/AddTask'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import { useNavigate } from 'react-router'
import { api } from '@qillqa/tiqsi'
import DialogoTarea from './DialogoTarea'
import { puedeEscribir, type EventoAgenda } from './tipos'
import { moduloActivo } from './apoyo'

const latido = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.18); }
`

const cuando = (e: EventoAgenda) => {
  const d = new Date(e.inicio)
  const fecha = d.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' })
  return e.todo_el_dia ? fecha : `${fecha} · ${d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`
}

export default function BotonAgendaDocumento({ documentoId, texto, recarga, alAvisar }: {
  documentoId: string
  /** Cómo se lee el documento (chip del vínculo de la tarea). */
  texto: string
  /** Cambia tras cada guardado: las fechas se vuelven a leer. */
  recarga?: unknown
  alAvisar?: (tipo: 'success' | 'error' | 'info', texto: string) => void
}) {
  const navegar = useNavigate()
  const [ancla, setAncla] = useState<HTMLElement | null>(null)
  const [propuestos, setPropuestos] = useState<EventoAgenda[]>([])
  const [tarea, setTarea] = useState(false)
  // Con Tareas y Agenda apagado (2026-10-18) no hay a dónde llevar la fecha.
  const escribe = puedeEscribir() && moduloActivo('tareas')

  const cargar = useCallback(() => {
    if (!escribe || !/^\d+$/.test(documentoId)) return
    const hoy = new Date()
    const desde = hoy.toISOString().slice(0, 10)
    const hasta = new Date(hoy.getTime() + 365 * 864e5).toISOString().slice(0, 10)
    api<{ eventos: EventoAgenda[] }>(`/api/agenda/eventos?entidad=doc:${documentoId}&desde=${desde}&hasta=${hasta}&con_solicitudes=true`)
      .then((r) => {
        const vistos = new Set<number>()
        setPropuestos(r.eventos.filter((e) => e.estado === 'propuesto' && !vistos.has(e.id) && vistos.add(e.id)))
      })
      .catch(() => setPropuestos([]))
  }, [documentoId, escribe])
  useEffect(cargar, [cargar, recarga])

  if (!escribe) return null

  const confirmar = async (e: EventoAgenda) => {
    try {
      await api(`/api/agenda/eventos/${e.id}/confirmar`, { method: 'POST' })
      alAvisar?.('success', `En la agenda: ${e.titulo}, ${cuando(e)}.`)
      cargar()
    } catch (err) {
      alAvisar?.('error', err instanceof Error ? err.message : 'No se pudo confirmar.')
    }
  }
  const descartar = async (e: EventoAgenda) => {
    try {
      await api(`/api/agenda/eventos/${e.id}`, { method: 'DELETE' })
      alAvisar?.('info', 'Fecha descartada; no se volverá a proponer.')
      cargar()
    } catch (err) {
      alAvisar?.('error', err instanceof Error ? err.message : 'No se pudo descartar.')
    }
  }

  const n = propuestos.length
  return (
    <>
      <Tooltip title={n ? `${n === 1 ? 'Una fecha' : `${n} fechas`} del documento por confirmar en la agenda` : `Crear una tarea vinculada a ${texto}`}>
        <IconButton
          size="small"
          aria-label={n ? 'Fechas por confirmar en la agenda' : 'Crear tarea vinculada'}
          onClick={(ev) => (n ? setAncla(ev.currentTarget) : setTarea(true))}
          sx={n ? { color: 'primary.main', animation: `${latido} 1.6s ease-in-out 3` } : undefined}
        >
          <Badge color="primary" badgeContent={n} invisible={!n} sx={{ '& .MuiBadge-badge': { fontSize: 10, height: 16, minWidth: 16 } }}>
            <AddTaskIcon fontSize="small" />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu anchorEl={ancla} open={Boolean(ancla)} onClose={() => setAncla(null)} slotProps={{ paper: { sx: { maxWidth: 360 } } }}>
        <Typography variant="overline" color="text.secondary" sx={{ px: 2, display: 'block', lineHeight: 2 }}>
          Fechas que anuncia el documento
        </Typography>
        {propuestos.map((e) => (
          <Box key={e.id} sx={{ px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <EventOutlinedIcon fontSize="small" sx={{ color: 'primary.main', mt: 0.25 }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{e.titulo}</Typography>
                <Typography variant="caption" color="text.secondary">{cuando(e)}{e.lugar ? ` · ${e.lugar}` : ''}</Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, mt: 0.75, pl: 3.5 }}>
              <Button size="small" variant="contained" onClick={() => void confirmar(e)}>Confirmar</Button>
              <Button size="small" color="inherit" sx={{ color: 'text.secondary' }} onClick={() => void descartar(e)}>Descartar</Button>
            </Box>
          </Box>
        ))}
        <Divider />
        <MenuItem onClick={() => { setAncla(null); navegar(`/agenda?vista=semana&fecha=${propuestos[0]?.inicio.slice(0, 10) ?? ''}`) }}>
          <ListItemIcon><EventOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Ver en la agenda" />
        </MenuItem>
        <MenuItem onClick={() => { setAncla(null); setTarea(true) }}>
          <ListItemIcon><AddTaskIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Crear una tarea" />
        </MenuItem>
      </Menu>
      {tarea && (
        <DialogoTarea abierto inicial={{ vinculos: [{ id: `doc:${documentoId}`, texto }] }} alCerrar={() => setTarea(false)} />
      )}
    </>
  )
}
