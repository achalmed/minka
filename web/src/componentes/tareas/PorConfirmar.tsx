/**
 * POR CONFIRMAR (2026-10-18, Edison: «el calendario y la agenda oficial del diputado solo
 * muestran lo confirmado»): lo que se pidió (gremios, instituciones, documentos recibidos, lo
 * detectado en un oficio) espera aquí, fuera del calendario, hasta que alguien lo confirma
 * (pasa al calendario y el tema «Agenda» del chat lo cuenta), le cambia la fecha o la hora (el
 * diputado suele moverlas) o lo descarta (queda con su historia, fuera de la lista).
 * Datos: `GET /api/agenda/por-confirmar`; acciones: `POST /api/agenda/eventos/{id}/confirmar`,
 * `/reprogramar` y `/descartar`. En escritorio va al lado del calendario; en el celular y la
 * tableta, como vista propia de la Agenda (`?vista=por_confirmar`).
 */
import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import TextField from '@mui/material/TextField'
import Alert from '@mui/material/Alert'
import Skeleton from '@mui/material/Skeleton'
import CheckIcon from '@mui/icons-material/Check'
import ScheduleIcon from '@mui/icons-material/Schedule'
import { api, PALETA } from '@qillqa/tiqsi'
import { avisarCambio, mensajeError, useAlCambiar } from './datos'
import { horaDe, isoDia } from './calendario'
import type { EventoAgenda } from './tipos'
import { avisoBreve } from './apoyo'
import { tituloAgenda } from './rotuloAgenda'

const cuando = (e: EventoAgenda) => {
  const d = new Date(e.inicio)
  const dia = d.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' })
  return e.todo_el_dia ? dia : `${dia} · ${horaDe(e.inicio)}${e.fin ? `–${horaDe(e.fin)}` : ''}`
}

function Solicitud({ e, alAbrir, soloLectura, descartada }: { e: EventoAgenda; alAbrir: () => void; soloLectura: boolean; descartada: boolean }) {
  const [mover, setMover] = useState(false)
  const [fecha, setFecha] = useState(isoDia(new Date(e.inicio)))
  const [hora, setHora] = useState(e.todo_el_dia ? '' : horaDe(e.inicio))
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')

  const accion = async (ruta: string, cuerpo: object | undefined, aviso: string) => {
    setOcupado(true)
    setError('')
    try {
      await api(`/api/agenda/eventos/${e.id}/${ruta}`, { method: 'POST', body: cuerpo ? JSON.stringify(cuerpo) : undefined })
      avisoBreve(aviso)
      setMover(false)
      avisarCambio()
    } catch (x) {
      setError(mensajeError(x))
    } finally {
      setOcupado(false)
    }
  }
  const reprogramar = () => {
    if (!fecha) return
    const todo = !hora
    const inicio = new Date(`${fecha}T${hora || '00:00'}`)
    void accion('reprogramar', { inicio: inicio.toISOString(), todo_el_dia: todo, version: e.version }, 'Fecha cambiada.')
  }
  const origen = e.vinculos[0]?.texto ?? ''
  const choque = e.choques?.[0]

  return (
    <Box sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', opacity: descartada ? 0.75 : 1 }}>
      <ButtonBase onClick={alAbrir} sx={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 1 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{tituloAgenda(e.titulo)}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {cuando(e)}{e.pasado && <Box component="span" sx={{ color: PALETA.error }}> · ya pasó</Box>}{e.lugar ? ` · ${e.lugar}` : ''}
        </Typography>
        {origen && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>{origen}</Typography>}
        {choque && (
          <Typography variant="caption" sx={{ display: 'block', color: choque.gravedad === 'alta' ? PALETA.error : PALETA.aviso }}>
            Coincide con «{choque.titulo}» {horaDe(choque.desde)}{(e.choques?.length ?? 0) > 1 ? ` y ${(e.choques?.length ?? 1) - 1} más` : ''}
          </Typography>
        )}
      </ButtonBase>
      {mover && (
        <Box sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField type="date" size="small" label="Fecha" value={fecha} onChange={(x) => setFecha(x.target.value)} InputLabelProps={{ shrink: true }} sx={{ flex: '1 1 140px' }} />
          <TextField type="time" size="small" label="Hora" value={hora} onChange={(x) => setHora(x.target.value)} InputLabelProps={{ shrink: true }} helperText={hora ? ' ' : 'Sin hora: todo el día'} sx={{ flex: '1 1 110px' }} />
          <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto' }}>
            <Button size="small" onClick={() => setMover(false)}>Cancelar</Button>
            <Button size="small" variant="contained" disabled={ocupado || !fecha} onClick={reprogramar}>Guardar</Button>
          </Box>
        </Box>
      )}
      {!soloLectura && !mover && (
        <Box sx={{ display: 'flex', gap: 0.75, mt: 1, flexWrap: 'wrap' }}>
          <Button size="small" variant="contained" startIcon={<CheckIcon fontSize="small" />} disabled={ocupado} onClick={() => void accion('confirmar', undefined, descartada ? 'Recuperada en el calendario.' : 'Confirmada: ya está en el calendario.')}>
            {descartada ? 'Recuperar' : 'Confirmar'}
          </Button>
          {!descartada && (
            <>
              <Button size="small" variant="outlined" startIcon={<ScheduleIcon fontSize="small" />} disabled={ocupado} onClick={() => setMover(true)}>Mover</Button>
              <Button size="small" color="inherit" disabled={ocupado} onClick={() => void accion('descartar', undefined, 'Descartada.')} sx={{ color: 'text.secondary', ml: 'auto' }}>Descartar</Button>
            </>
          )}
        </Box>
      )}
      {error && <Alert severity="error" sx={{ mt: 1, py: 0 }}>{error}</Alert>}
    </Box>
  )
}

export default function PorConfirmar({ alAbrir, soloLectura, alContar }: {
  alAbrir: (e: EventoAgenda) => void
  soloLectura: boolean
  /** Cuántas esperan (para el contador de la Agenda). */
  alContar?: (n: number) => void
}) {
  const [eventos, setEventos] = useState<EventoAgenda[] | null>(null)
  const [descartadas, setDescartadas] = useState(false)
  const [error, setError] = useState('')
  const leer = useCallback(() => {
    api<{ eventos: EventoAgenda[]; total: number }>(`/api/agenda/por-confirmar${descartadas ? '?descartadas=true' : ''}`)
      .then((r) => { setEventos(r.eventos); setError(''); if (!descartadas) alContar?.(r.total) })
      .catch((e) => setError(mensajeError(e)))
  }, [descartadas, alContar])
  useEffect(leer, [leer])
  useAlCambiar(leer)

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2.5, bgcolor: 'background.paper', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', bgcolor: PALETA.superficieTenue }}>
        <Typography sx={{ fontWeight: 650, fontSize: 14, flex: 1 }}>{descartadas ? 'Descartadas' : 'Por confirmar'}</Typography>
        {eventos && <Typography variant="caption" color="text.secondary">{eventos.length}</Typography>}
      </Box>
      {error && <Alert severity="error" sx={{ borderRadius: 0, py: 0 }}>{error}</Alert>}
      {!eventos && !error && <Box sx={{ p: 1.5 }}><Skeleton /><Skeleton width="60%" /></Box>}
      {eventos?.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 1.5 }}>
          {descartadas ? 'Nada descartado en los últimos 60 días.' : 'Nada por confirmar.'}
        </Typography>
      )}
      {eventos?.map((e) => <Solicitud key={`${e.id}-${e.version}`} e={e} alAbrir={() => alAbrir(e)} soloLectura={soloLectura} descartada={descartadas} />)}
      <Box sx={{ px: 1.5, py: 0.75, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="caption" color="text.disabled">{descartadas ? 'Recuperar la devuelve al calendario.' : 'No salen en el calendario hasta confirmarlas.'}</Typography>
        <Button size="small" color="inherit" sx={{ color: 'text.secondary', fontSize: 12.5 }} onClick={() => { setEventos(null); setDescartadas((d) => !d) }}>
          {descartadas ? 'Volver' : 'Descartadas'}
        </Button>
      </Box>
    </Box>
  )
}

