/**
 * PEGAR ACTIVIDADES en la Agenda (2026-10-11): el resultado del prompt de agenda (bloque
 * `agenda-actividades`) → `POST /api/agenda/pegar` devuelve cada actividad como evento
 * listo, el evento parecido que ya está, sus choques y quién es cada participante → la
 * persona marca cuáles agendar → `POST /api/agenda/eventos` por cada una (o vincular la
 * que ya existe). Constancia en `pegados`. Nada se crea sin marcar. Lo que el prompt trae con
 * «Confirmación» (a quién y hasta cuándo responder) entra por confirmar (2026-10-18).
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import Link from '@mui/material/Link'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import LinearProgress from '@mui/material/LinearProgress'
import { api, PALETA } from '@qillqa/tiqsi'
import { mensajePegado, registrarPegado, type LecturaPegado, usePausaTrasLeer } from './apoyo'
import { avisarCambio, mensajeError } from './datos'
import type { Participante } from './tipos'

interface EventoListo {
  titulo: string; descripcion: string; tipo: string; estado: string; inicio: string; fin: string | null; todo_el_dia: boolean
  lugar: string; modalidad: string; enlace: string; responsable_id: number | null; participantes: Participante[]; vinculos: string[]
}
interface Actividad {
  n: number
  evento: EventoListo
  existente: { id: number; titulo: string; inicio: string } | null
  choques: { titulo: string; gravedad: string }[]
  participantes_sin_casar: string[]
  documento: string
  recordatorio_minutos: number | null
  dudas: Record<string, { valor: string; opciones: string[] }>
  estado: 'nuevo' | 'existente' | 'con_choques'
}

const cuando = (iso: string, todoElDia: boolean) => {
  const d = new Date(iso)
  return d.toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: '2-digit' }) + (todoElDia ? '' : ` ${iso.slice(11, 16)}`)
}

export default function DialogoPegarAgenda({ abierto, alCerrar, vinculos = [], textoInicial, alCrear }: {
  abierto: boolean
  alCerrar: () => void
  vinculos?: string[]
  /** Texto que llega ya pegado (del chat): se lee solo al abrir. */
  textoInicial?: string
  /** Cada evento NUEVO que se agendó (el chat lo anuncia en el canal, fase 9.6). */
  alCrear?: (id: number) => void
}) {
  const navegar = useNavigate()
  const [texto, setTexto] = useState('')
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState('')
  const [lectura, setLectura] = useState<LecturaPegado | null>(null)
  const [acts, setActs] = useState<Actividad[]>([])
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set())
  const [guardando, setGuardando] = useState(false)

  const cerrar = () => { setTexto(''); setLectura(null); setActs([]); setError(''); alCerrar() }

  const leer = async (t: string = texto) => {
    setLeyendo(true)
    setError('')
    try {
      const r = await api<{ lectura: LecturaPegado; actividades: Actividad[] }>('/api/agenda/pegar', { method: 'POST', body: JSON.stringify({ texto: t, vinculos }) })
      setLectura(r.lectura)
      setActs(r.actividades)
      // Por omisión se agendan las nuevas (con o sin choques); la que ya existe, solo si hay algo que vincular.
      setMarcadas(new Set(r.actividades.filter((a) => a.estado !== 'existente' || vinculos.length > 0).map((a) => a.n)))
    } catch (e) {
      setError(mensajePegado(e))
    } finally {
      setLeyendo(false)
    }
  }

  const leidoInicial = useRef('')
  useEffect(() => {
    if (!abierto || !textoInicial || leidoInicial.current === textoInicial) return
    leidoInicial.current = textoInicial
    setTexto(textoInicial)
    void leer(textoInicial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, textoInicial])

  const agendar = async () => {
    if (!lectura) return
    setGuardando(true)
    setError('')
    const fallidas: string[] = []
    for (const a of acts) {
      if (!marcadas.has(a.n)) continue
      try {
        let entidad = ''
        if (a.existente) {
          for (const v of vinculos) await api(`/api/agenda/eventos/${a.existente.id}/vincular`, { method: 'POST', body: JSON.stringify({ destino: v }) })
          entidad = `evento:${a.existente.id}`
        } else {
          const creado = await api<{ id: number }>('/api/agenda/eventos', { method: 'POST', body: JSON.stringify(a.evento) })
          entidad = `evento:${creado.id}`
          alCrear?.(creado.id)
        }
        void registrarPegado({
          tipo: lectura.tipo, version: lectura.version, fuente: lectura.fuente, texto, entidad,
          campos_propuestos: a.evento as unknown as Record<string, unknown>, campos_aplicados: a.evento as unknown as Record<string, unknown>, rechazados: [],
        })
      } catch (e) {
        fallidas.push(`${a.evento.titulo}: ${mensajeError(e)}`)
      }
    }
    setGuardando(false)
    avisarCambio()
    if (fallidas.length) setError(`No se agendó: ${fallidas.join('; ')}`)
    else cerrar()
  }

  const alternar = (n: number) => setMarcadas((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x })

  const pausa = usePausaTrasLeer(Boolean(lectura))
  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle>Pegar actividades</DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {!lectura && (
          <>
            <Typography variant="body2" color="text.secondary">
              Pegue aquí la respuesta de la IA con las actividades.
            </Typography>
            <TextField multiline minRows={6} maxRows={16} autoFocus size="small" value={texto} onChange={(e) => setTexto(e.target.value)} label="Respuesta de la IA" />
            {leyendo && <LinearProgress />}
          </>
        )}
        {lectura && (
          <>
            {lectura.avisos.map((a) => <Alert key={a} severity="info" sx={{ py: 0 }}>{a}</Alert>)}
            {acts.length === 0 && <Alert severity="warning" sx={{ py: 0 }}>El bloque no trae actividades.</Alert>}
            {acts.map((a) => (
              <Box key={a.n} sx={{ display: 'flex', gap: 0.5, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: PALETA.superficieTenue, opacity: marcadas.has(a.n) ? 1 : 0.6 }}>
                <Checkbox size="small" checked={marcadas.has(a.n)} onChange={() => alternar(a.n)} sx={{ p: 0.25, alignSelf: 'flex-start' }} inputProps={{ 'aria-label': `Agendar ${a.evento.titulo}` }} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{a.evento.titulo}</Typography>
                    <Chip size="small" label={a.estado === 'existente' ? 'ya está en la Agenda' : a.estado === 'con_choques' ? 'cruce de horario' : 'nueva'} sx={{ height: 20, fontSize: 11, bgcolor: a.estado === 'nuevo' ? PALETA.exitoFondo : PALETA.avisoFondo }} />
                    {!a.existente && (
                      // 2026-10-18: lo que espera respuesta va a «Por confirmar» (fuera del calendario); un toque lo cambia.
                      <Chip
                        size="small"
                        variant="outlined"
                        label={a.evento.estado === 'propuesto' ? 'por confirmar' : 'confirmada'}
                        onClick={() => setActs((xs) => xs.map((x) => (x.n === a.n ? { ...x, evento: { ...x.evento, estado: x.evento.estado === 'propuesto' ? 'confirmado' : 'propuesto' } } : x)))}
                        sx={{ height: 20, fontSize: 11, borderColor: a.evento.estado === 'propuesto' ? PALETA.dorado : 'divider' }}
                      />
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {[cuando(a.evento.inicio, a.evento.todo_el_dia), a.evento.tipo, a.evento.lugar, a.evento.modalidad !== 'presencial' ? a.evento.modalidad : ''].filter(Boolean).join(' · ')}
                  </Typography>
                  {a.existente && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      Ya existe «{a.existente.titulo}» ({cuando(a.existente.inicio, false)}): no se duplica{vinculos.length ? '; se vincula' : ''}.{' '}
                      <Link component="button" type="button" variant="caption" onClick={() => { cerrar(); navegar(`/agenda?abrir=${a.existente!.id}`) }}>Abrir</Link>
                    </Typography>
                  )}
                  {a.choques.map((c) => <Typography key={c.titulo} variant="caption" sx={{ display: 'block', color: PALETA.error }}>Cruza con «{c.titulo}»{c.gravedad === 'alta' ? ' (misma persona o sesión)' : ''}.</Typography>)}
                  {a.evento.participantes.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Participa: {a.evento.participantes.map((p) => p.nombre).join(', ')}</Typography>}
                  {a.participantes_sin_casar.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Sin casar con el equipo ni el directorio: {a.participantes_sin_casar.join(', ')} (añádalos después en el evento).</Typography>}
                  {Object.entries(a.dudas).map(([k, d]) => <Typography key={k} variant="caption" sx={{ display: 'block', color: PALETA.dorado }}>{k}: «{d.valor}» no está entre {d.opciones.join(', ')}; queda el valor por omisión.</Typography>)}
                </Box>
              </Box>
            ))}
          </>
        )}
        {error && <Alert severity="error" sx={{ py: 0 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={cerrar}>Cancelar</Button>
        {lectura && <Button color="inherit" onClick={() => { setLectura(null); setActs([]) }}>Volver a pegar</Button>}
        {!lectura
          ? <Button variant="contained" disabled={!texto.trim() || leyendo} onClick={() => void leer()}>Leer</Button>
          : <Button variant="contained" disabled={guardando || marcadas.size === 0 || pausa} onClick={() => void agendar()}>Agendar {marcadas.size ? `(${marcadas.size})` : ''}</Button>}
      </DialogActions>
    </Dialog>
  )
}
