/**
 * TARJETA RÁPIDA de un evento de la Agenda (2026-10-19 por la tarde; Edison: «al hacer clic en la
 * tarjeta de la agenda me abre el formulario y eso no es productivo: debería abrir una tarjeta bonita
 * con la información necesaria, con la opción de abrir el formulario, y que me permita navegar como
 * el visor rápido»). Lo necesario de un vistazo: tipo, título, día y hora, lugar y modalidad,
 * responsable y participantes, descripción, vínculos, serie, estado. Se pasa al evento siguiente o
 * anterior de la vista deslizando de lado (o con flechas y teclas en el escritorio); «Abrir
 * formulario» lleva al de siempre. Día, tres días, semana y mes la usan por igual.
 */
import { useEffect, useRef, useState, type PointerEvent as PointerEventReact } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloseIcon from '@mui/icons-material/Close'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined'
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline'
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined'
import RepeatIcon from '@mui/icons-material/Repeat'
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined'
import { Link as RouterLink } from 'react-router'
import { PALETA } from '@qillqa/tiqsi'
import { COLOR_TIPO, FONDO_TIPO, NOMBRE_TIPO, type EventoAgenda } from './tipos'
import { desdeIso, horaDe, rutaVinculo, textoRecurrencia, tituloDia } from './calendario'
import { tituloAgenda } from './rotuloAgenda'

/** La clave con que se identifica una fila de la vista (una ocurrencia de una serie es una fila propia). */
export const claveDe = (e: EventoAgenda): string => e.clave ?? String(e.id)

/** Los eventos de la vista en el orden en que se navega: por inicio y luego por id. Pura. */
export function ordenados(eventos: readonly EventoAgenda[]): EventoAgenda[] {
  return [...eventos].sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : a.id - b.id))
}

const ESTADO: Record<string, string> = { propuesto: 'Por confirmar', cancelado: 'Cancelado', suspendido: 'Suspendido', realizado: 'Realizado' }

function cuando(e: EventoAgenda): string {
  const dia = tituloDia(desdeIso(e.inicio.slice(0, 10)))
  if (e.todo_el_dia) {
    const fin = e.fin && e.fin.slice(0, 10) !== e.inicio.slice(0, 10) ? ` → ${tituloDia(desdeIso(e.fin.slice(0, 10)))}` : ''
    return `${dia}${fin} · todo el día`
  }
  return `${dia} · ${horaDe(e.inicio)}${e.fin ? `–${horaDe(e.fin)}` : ''}`
}

export default function TarjetaEvento({ eventos, clave, alCerrar, alIr, alFormulario }: {
  /** Los eventos de la vista (el orden lo pone la tarjeta). */
  eventos: readonly EventoAgenda[]
  /** La fila abierta (null = cerrada). */
  clave: string | null
  alCerrar: () => void
  alIr: (clave: string) => void
  alFormulario: (e: EventoAgenda) => void
}) {
  const tema = useTheme()
  const celular = useMediaQuery(tema.breakpoints.down('sm'))
  const lista = ordenados(eventos)
  const i = clave === null ? -1 : lista.findIndex((x) => claveDe(x) === clave)
  const e = i >= 0 ? lista[i] : null
  const anterior = i > 0 ? lista[i - 1] : null
  const siguiente = i >= 0 && i < lista.length - 1 ? lista[i + 1] : null
  const toque = useRef<{ x: number; y: number; t: number } | null>(null)
  const [dx, setDx] = useState(0)
  useEffect(() => { setDx(0) }, [clave])

  const alBajar = (ev: PointerEventReact<HTMLDivElement>) => { toque.current = { x: ev.clientX, y: ev.clientY, t: performance.now() } }
  const alMover = (ev: PointerEventReact<HTMLDivElement>) => { const t = toque.current; if (t && Math.abs(ev.clientX - t.x) > Math.abs(ev.clientY - t.y)) setDx(ev.clientX - t.x) }
  const alSoltar = (ev: PointerEventReact<HTMLDivElement>) => {
    const t = toque.current
    toque.current = null
    setDx(0)
    if (!t) return
    const d = ev.clientX - t.x
    const rapido = performance.now() - t.t < 400
    if (Math.abs(d) < Math.abs(ev.clientY - t.y) * 1.5) return
    if (Math.abs(d) >= 80 || (rapido && Math.abs(d) >= 40)) {
      if (d < 0 && siguiente) alIr(claveDe(siguiente))
      else if (d > 0 && anterior) alIr(claveDe(anterior))
    }
  }
  const color = e ? COLOR_TIPO[e.tipo] ?? PALETA.textoTenue : PALETA.textoTenue
  const fondo = e ? FONDO_TIPO[e.tipo] ?? PALETA.superficieMedia : PALETA.superficieMedia
  return (
    <Dialog
      open={e !== null}
      onClose={alCerrar}
      fullWidth
      maxWidth="xs"
      onKeyDown={(ev) => {
        if (ev.key === 'ArrowRight' && siguiente) alIr(claveDe(siguiente))
        else if (ev.key === 'ArrowLeft' && anterior) alIr(claveDe(anterior))
        else if (ev.key === 'Enter' && e) alFormulario(e)
      }}
      PaperProps={{ sx: { borderRadius: 3, overflow: 'hidden', m: celular ? 1.5 : 4, width: celular ? 'calc(100% - 24px)' : undefined } }}
    >
      {e && (
        <Box onPointerDown={alBajar} onPointerMove={alMover} onPointerUp={alSoltar} onPointerCancel={() => { toque.current = null; setDx(0) }} sx={{ touchAction: 'pan-y', userSelect: 'none', minWidth: 0, maxWidth: '100%', overflow: 'hidden', transform: dx ? `translateX(${dx * 0.35}px)` : 'none', transition: dx ? 'none' : 'transform .2s ease-out' }}>
          {/* Cabecera del color del tipo: tipo y estado; cerrar. */}
          <Box sx={{ bgcolor: fondo, px: 2, pt: 1.5, pb: 1.25, display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color }}>{NOMBRE_TIPO[e.tipo] ?? e.tipo}</Typography>
                {ESTADO[e.estado] && <Chip size="small" label={ESTADO[e.estado]} sx={{ height: 18, fontSize: 10.5, fontWeight: 600, color: e.estado === 'propuesto' ? PALETA.aviso : 'text.secondary', bgcolor: PALETA.superficie }} />}
                {e.recurrencia && <Chip size="small" icon={<RepeatIcon sx={{ fontSize: '13px !important' }} />} label={textoRecurrencia(e.recurrencia)} sx={{ height: 18, fontSize: 10.5, bgcolor: PALETA.superficie, color: 'text.secondary' }} />}
              </Box>
              <Typography component="h2" sx={{ fontSize: 18, fontWeight: 650, lineHeight: 1.25, color: PALETA.texto, overflowWrap: 'anywhere', textDecoration: e.estado === 'cancelado' || e.estado === 'suspendido' ? 'line-through' : 'none' }}>{tituloAgenda(e.titulo)}</Typography>
            </Box>
            <IconButton size="small" onClick={alCerrar} aria-label="Cerrar" sx={{ mt: -0.5, mr: -0.75 }}><CloseIcon fontSize="small" /></IconButton>
          </Box>

          <Box sx={{ px: 2, py: 1.5, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 1.1, minWidth: 0 }}>
            <Fila icono={<ScheduleOutlinedIcon fontSize="small" />} texto={cuando(e)} fuerte />
            {(e.lugar || e.modalidad) && <Fila icono={<PlaceOutlinedIcon fontSize="small" />} texto={[e.lugar, e.modalidad && e.modalidad !== 'presencial' ? e.modalidad : ''].filter(Boolean).join(' · ')} />}
            {e.enlace && <Fila icono={<VideocamOutlinedIcon fontSize="small" />} texto={<Box component="a" href={e.enlace} target="_blank" rel="noopener" sx={{ color: 'primary.main', overflowWrap: 'anywhere' }}>{e.enlace.replace(/^https?:\/\//, '')}</Box>} />}
            {(e.responsable || (e.participantes?.length ?? 0) > 0) && (
              <Fila icono={<PeopleOutlineIcon fontSize="small" />} texto={[e.responsable ? `${e.responsable} (responsable)` : '', ...(e.participantes ?? []).map((p) => p.nombre)].filter(Boolean).join(', ')} />
            )}
            {e.descripcion && <Typography variant="body2" sx={{ color: 'text.primary', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word', minWidth: 0, maxHeight: '12em', overflowY: 'auto' }}>{e.descripcion}</Typography>}
            {(e.vinculos?.length ?? 0) > 0 && (
              <Fila icono={<LinkOutlinedIcon fontSize="small" />} texto={(
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {e.vinculos.map((v) => {
                    const ruta = rutaVinculo(v.id)
                    return ruta
                      ? <Chip key={v.id} size="small" clickable component={RouterLink} to={ruta} label={v.texto} sx={{ height: 'auto', minHeight: 22, fontSize: 11.5, bgcolor: PALETA.superficieMedia, maxWidth: '100%', '& .MuiChip-label': { whiteSpace: 'normal', overflowWrap: 'anywhere', py: 0.25 } }} />
                      : <Chip key={v.id} size="small" label={v.texto} sx={{ height: 'auto', minHeight: 22, fontSize: 11.5, bgcolor: PALETA.superficieMedia, maxWidth: '100%', '& .MuiChip-label': { whiteSpace: 'normal', overflowWrap: 'anywhere', py: 0.25 } }} />
                  })}
                </Box>
              )} />
            )}
          </Box>

          {/* Pie: anterior y siguiente, la posición y «Abrir formulario». */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, pb: 1.25, pt: 0.25 }}>
            <IconButton size="small" onClick={() => anterior && alIr(claveDe(anterior))} disabled={!anterior} aria-label="Evento anterior"><ChevronLeftIcon /></IconButton>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', minWidth: 44, textAlign: 'center' }}>{i + 1} de {lista.length}</Typography>
            <IconButton size="small" onClick={() => siguiente && alIr(claveDe(siguiente))} disabled={!siguiente} aria-label="Evento siguiente"><ChevronRightIcon /></IconButton>
            <Box sx={{ flex: 1 }} />
            <Button size="small" variant="contained" startIcon={<EditOutlinedIcon />} onClick={() => alFormulario(e)}>Abrir formulario</Button>
          </Box>
        </Box>
      )}
    </Dialog>
  )
}

function Fila({ icono, texto, fuerte }: { icono: React.ReactNode; texto: React.ReactNode; fuerte?: boolean }) {
  return (
    <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', color: 'text.secondary' }}>
      <Box sx={{ display: 'flex', mt: '1px', flexShrink: 0 }}>{icono}</Box>
      <Typography variant="body2" component="div" sx={{ color: fuerte ? 'text.primary' : 'text.secondary', fontWeight: fuerte ? 600 : 400, overflowWrap: 'anywhere', wordBreak: 'break-word', minWidth: 0, flex: 1 }}>{texto}</Typography>
    </Box>
  )
}
