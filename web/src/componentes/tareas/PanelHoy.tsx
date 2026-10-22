/**
 * HOY: la agenda del día (con sus choques) y las tareas de la persona para hoy, incluidas
 * las vencidas, en un solo vistazo. Es la vista «Hoy» del módulo y, en `compacto`, la
 * tarjeta del Inicio (reemplaza al mensaje nocturno «mañana: …» y a los fijados del chat).
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import ButtonBase from '@mui/material/ButtonBase'
import Alert from '@mui/material/Alert'
import Skeleton from '@mui/material/Skeleton'
import EventNoteOutlinedIcon from '@mui/icons-material/EventNoteOutlined'
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { api, PALETA } from '@qillqa/tiqsi'
import { useAlCambiar } from './datos'
import { textoCruces } from './organizar'
import { horaDe, tituloDia, desdeIso } from './calendario'
import FilaTarea from './FilaTarea'
import MarcaCruce, { LineaAtencion } from './MarcaCruce'
import { tituloAgenda } from './rotuloAgenda'
import { COLOR_TIPO, puedeEscribir, type Choque, type EventoAgenda, type Tarea } from './tipos'

interface Hoy {
  fecha: string
  eventos: EventoAgenda[]
  choques: Choque[]
  tareas: Tarea[]
  /** Solicitudes que esperan confirmación (no salen en la agenda del día: 2026-10-18). */
  por_confirmar?: number
}

// 2026-10-06: sin `ruta`, el encabezado no es enlace (en la vista «Hoy» de Tareas
// «Mis tareas de hoy» llevaba a la misma página en la que ya se está).
function Encabezado({ icono, texto, n, ruta }: { icono: React.ReactNode; texto: string; n: number; ruta?: string }) {
  const navegar = useNavigate()
  // 2026-10-19 (Edison: «cuadros, líneas… no aportan nada; limpio, moderno, minimalista»): sin relleno.
  const sx = { display: 'flex', width: '100%', justifyContent: 'flex-start', alignItems: 'center', gap: 1, px: 2, pt: 1.5, pb: 0.75 }
  const interior = (
    <>
      <Box sx={{ color: 'primary.main', display: 'flex' }}>{icono}</Box>
      <Typography sx={{ fontWeight: 700, fontSize: 15, flex: 1, textAlign: 'left', letterSpacing: -0.1 }}>{texto}</Typography>
      <Typography variant="caption" color="text.disabled">{n}</Typography>
      {ruta && <ChevronRightIcon sx={{ color: 'text.disabled', fontSize: 20 }} />}
    </>
  )
  return ruta ? (
    <ButtonBase onClick={() => navegar(ruta)} sx={sx}>{interior}</ButtonBase>
  ) : (
    <Box sx={sx}>{interior}</Box>
  )
}

export default function PanelHoy({ compacto, alAbrirTarea, alAbrirEvento }: {
  compacto?: boolean
  alAbrirTarea?: (t: Tarea) => void
  alAbrirEvento?: (e: EventoAgenda) => void
}) {
  const navegar = useNavigate()
  const [hoy, setHoy] = useState<Hoy | null>(null)
  const [error, setError] = useState('')
  const leer = useCallback(() => {
    api<Hoy>('/api/agenda/hoy').then((h) => { setHoy(h); setError('') }).catch((e) => setError(e instanceof Error ? e.message : 'No se pudo leer el día.'))
  }, [])
  useEffect(leer, [leer])
  useAlCambiar(leer)

  if (error && !hoy) return compacto ? null : <Alert severity="error">{error}</Alert>
  const abrirT = alAbrirTarea ?? ((t: Tarea) => navegar(`/tareas?abrir=${t.id}`))
  // 2026-10-19 (Edison): tocar un evento de hoy abre el DÍA del calendario, no el formulario del evento.
  const abrirE = alAbrirEvento ?? (() => navegar(`/agenda?vista=dia&fecha=${hoy?.fecha ?? ''}`))
  const vencidas = hoy?.tareas.filter((t) => t.vencida).length ?? 0
  const max = compacto ? 5 : 200

  return (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: compacto ? '1fr 1fr' : '2fr 3fr' }, mb: compacto ? 3 : 0 }}>
      <Box sx={{ border: '1px solid', borderColor: PALETA.borde, borderRadius: 3, bgcolor: 'background.paper', overflow: 'hidden', alignSelf: 'start', pb: 0.75 }}>
        <Encabezado icono={<EventNoteOutlinedIcon fontSize="small" />} texto={hoy ? `Agenda de hoy · ${tituloDia(desdeIso(hoy.fecha))}` : 'Agenda de hoy'} n={hoy?.eventos.length ?? 0} ruta="/agenda?vista=dia" />
        {!hoy && <Box sx={{ p: 2 }}><Skeleton /><Skeleton width="60%" /></Box>}
        {/* 2026-10-19 (Edison: «la notificación en amarillo es muy grande»; el triángulo «se ve feo»): una
            línea tenue con punto arena; el detalle, la pastilla «cruce» en cada evento. */}
        {hoy && hoy.choques.length > 0 && (
          <LineaAtencion texto={`${textoCruces(hoy.choques.length)} · decida quién va`} alPulsar={() => navegar(`/agenda?vista=dia&fecha=${hoy.fecha}`)} sx={{ py: 0.4 }} />
        )}
        {hoy && hoy.eventos.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>Nada agendado para hoy.</Typography>}
        {(hoy?.por_confirmar ?? 0) > 0 && (
          <LineaAtencion texto={`${hoy?.por_confirmar} por confirmar`} alPulsar={() => navegar('/agenda?vista=por_confirmar')} sx={{ py: 0.4 }} />
        )}
        {hoy?.eventos.slice(0, max).map((e) => (
          <ButtonBase key={e.clave ?? e.id} onClick={() => abrirE(e)} sx={{ display: 'flex', alignItems: 'flex-start', width: '100%', justifyContent: 'flex-start', textAlign: 'left', gap: 1.5, px: 2, py: 1.1, borderRadius: 1.5, '&:hover': { bgcolor: 'action.hover' } }}>
            {/* 2026-10-19: el título entero (nada cortado con «…»), la hora de inicio y fin en una
                sola columna y el lugar en su línea: lo que el diputado necesita leer de un vistazo. */}
            <Box sx={{ width: 44, flexShrink: 0, pt: 0.1 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2, color: COLOR_TIPO[e.tipo] ?? 'text.primary' }}>{e.todo_el_dia ? 'Día' : horaDe(e.inicio)}</Typography>
              {e.fin && !e.todo_el_dia && <Typography sx={{ fontSize: 11, lineHeight: 1.2, color: 'text.disabled' }}>{horaDe(e.fin)}</Typography>}
              {e.choque && <MarcaCruce />}
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: 14.5, lineHeight: 1.35, overflowWrap: 'anywhere', textDecoration: e.estado === 'cancelado' || e.estado === 'suspendido' ? 'line-through' : 'none' }}>
                {tituloAgenda(e.titulo)}
              </Typography>
              {e.lugar && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.2, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{e.lugar}</Typography>
              )}
            </Box>
          </ButtonBase>
        ))}
      </Box>
      <Box sx={{ border: '1px solid', borderColor: PALETA.borde, borderRadius: 3, bgcolor: 'background.paper', overflow: 'hidden', alignSelf: 'start', pb: 0.75 }}>
        <Encabezado icono={<ChecklistOutlinedIcon fontSize="small" />} texto={vencidas ? `Mis tareas de hoy · ${vencidas} vencida(s)` : 'Mis tareas de hoy'} n={hoy?.tareas.length ?? 0} ruta={compacto ? '/tareas?ver=hoy' : undefined} />
        {!hoy && <Box sx={{ p: 2 }}><Skeleton /><Skeleton width="70%" /></Box>}
        {hoy && hoy.tareas.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>Nada pendiente para hoy.</Typography>}
        {hoy?.tareas.slice(0, max).map((t) => <FilaTarea key={t.id} t={t} alAbrir={() => abrirT(t)} soloLectura={!puedeEscribir()} conResponsable={false} compacta />)}
        {hoy && hoy.tareas.length > max && (
          <ButtonBase onClick={() => navegar('/tareas?ver=hoy')} sx={{ width: '100%', py: 1, color: 'primary.main', fontSize: 13.5, fontWeight: 600 }}>Ver las {hoy.tareas.length}</ButtonBase>
        )}
      </Box>
    </Box>
  )
}
