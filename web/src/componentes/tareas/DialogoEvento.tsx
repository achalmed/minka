/**
 * Ficha de un EVENTO de la agenda: qué (tipo y estado), cuándo (o todo el día, y si se
 * repite cada semana), dónde (lugar, modalidad, enlace), quién va (cuentas del equipo,
 * personas del directorio o un nombre, cada uno con su papel) y con qué se relaciona.
 * Mientras se llena, avisa si choca con otra cosa de la agenda (dos comisiones a la
 * misma hora, alguien que no puede estar en dos sitios) y, si es nuevo, si ya hay uno parecido
 * ese día (2026-10-18: «Abrir» cambia la ficha a la del que ya está). Lo por confirmar no sale en
 * el calendario hasta confirmarlo. Al pie, en una línea tenue, quién lo creó y quién lo editó.
 */
import { useEffect, useRef, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import Autocomplete from '@mui/material/Autocomplete'
import Alert from '@mui/material/Alert'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import LinearProgress from '@mui/material/LinearProgress'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined'
import ContentPasteOutlinedIcon from '@mui/icons-material/ContentPasteOutlined'
import { api, confirmar, PALETA } from '@qillqa/tiqsi'
import { buscarPersonas } from './apoyo'
import { avisarCambio, mensajeError, useOpcionesAgenda } from './datos'
import { DIAS_CORTOS, diaSemana, horaDe, isoDia } from './calendario'
import SelectorVinculos from './SelectorVinculos'
import AvisoParecido, { useParecido } from './AvisoParecido'
import { lineaAutoria } from './organizar'
import type { EventoAgenda, Participante, Recurrencia, Vinculo } from './tipos'
import { tituloAgenda } from './rotuloAgenda'

interface PersonaDir { id: number; nombre: string; cargo: string }

interface Borrador {
  titulo: string
  descripcion: string
  tipo: string
  estado: string
  fecha: string
  hora: string
  fecha_fin: string
  hora_fin: string
  todo_el_dia: boolean
  lugar: string
  modalidad: string
  enlace: string
  repetir: '' | 'semanal' | 'quincenal' | 'diaria'
  dias: number[]
  hasta: string
  responsable_id: number | null
  participantes: Participante[]
  vinculos: Vinculo[]
  /** '' = por omisión del tipo; '0' = sin recordatorio; minutos. */
  recordatorio: string
}

const masHora = (h: string, minutos: number) => {
  const [a, b] = h.split(':').map(Number)
  const t = Math.min(23 * 60 + 59, a * 60 + b + minutos)
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

const nuevo = (fecha: string, hora: string): Borrador => ({
  titulo: '', descripcion: '', tipo: 'despacho', estado: 'confirmado', fecha, hora, fecha_fin: fecha, hora_fin: masHora(hora, 60),
  todo_el_dia: false, lugar: '', modalidad: 'presencial', enlace: '', repetir: '', dias: [diaSemana(new Date(`${fecha}T00:00`))], hasta: '',
  responsable_id: null, participantes: [], vinculos: [], recordatorio: '',
})

const deEvento = (e: EventoAgenda): Borrador => {
  const r = e.recurrencia
  return {
    titulo: e.titulo, descripcion: e.descripcion, tipo: e.tipo, estado: e.estado,
    fecha: isoDia(new Date(e.inicio)), hora: horaDe(e.inicio),
    fecha_fin: e.fin ? isoDia(new Date(e.fin)) : isoDia(new Date(e.inicio)), hora_fin: e.fin ? horaDe(e.fin) : masHora(horaDe(e.inicio), 60),
    todo_el_dia: e.todo_el_dia, lugar: e.lugar, modalidad: e.modalidad, enlace: e.enlace,
    repetir: !r ? '' : r.frecuencia === 'diaria' || (r.dias?.length ?? 0) === 7 ? 'diaria' : (r.intervalo ?? 1) === 2 ? 'quincenal' : 'semanal',
    dias: r?.dias?.length ? r.dias : [diaSemana(new Date(e.inicio))], hasta: r?.hasta ?? '',
    responsable_id: e.responsable_id, participantes: e.participantes, vinculos: e.vinculos,
    recordatorio: e.recordatorio_minutos == null ? '' : String(e.recordatorio_minutos),
  }
}

function cuerpo(b: Borrador) {
  const inicio = b.todo_el_dia ? new Date(`${b.fecha}T00:00`) : new Date(`${b.fecha}T${b.hora || '00:00'}`)
  const fin = b.todo_el_dia
    ? (b.fecha_fin && b.fecha_fin > b.fecha ? new Date(`${b.fecha_fin}T00:00`) : null)
    : new Date(`${b.fecha_fin || b.fecha}T${b.hora_fin || b.hora}`)
  const recurrencia: Recurrencia | null = !b.repetir
    ? null
    : b.repetir === 'diaria'
      ? { frecuencia: 'diaria', hasta: b.hasta || null }
      : { frecuencia: 'semanal', intervalo: b.repetir === 'quincenal' ? 2 : 1, dias: b.dias, hasta: b.hasta || null }
  return {
    titulo: b.titulo.trim(), descripcion: b.descripcion, tipo: b.tipo, estado: b.estado, inicio: inicio.toISOString(),
    fin: fin ? fin.toISOString() : null, todo_el_dia: b.todo_el_dia, lugar: b.lugar, modalidad: b.modalidad, enlace: b.enlace,
    recurrencia, responsable_id: b.responsable_id,
    participantes: b.participantes.map((p) => ({ usuario_id: p.usuario_id, persona_id: p.persona_id, nombre: p.nombre, rol: p.rol, confirmado: p.confirmado })),
    vinculos: b.vinculos.map((v) => v.id),
    recordatorio_minutos: b.recordatorio === '' ? null : Number(b.recordatorio),
  }
}

interface ChoqueVerificado { clave: string; titulo: string; desde: string; hasta: string; gravedad: string; comparten: string[] }

export default function DialogoEvento({ abierto, eventoId, ocurrencia, inicial, alCerrar, alPegar, alCrear }: {
  abierto: boolean
  eventoId?: number | null
  /** Fecha de la ocurrencia pulsada (para «omitir solo esta fecha» en una serie). */
  ocurrencia?: string | null
  /** Para un evento nuevo: fecha y hora pulsadas en el calendario y otros valores. */
  inicial?: { fecha?: string; hora?: string; vinculos?: Vinculo[]; titulo?: string; tipo?: string }
  alCerrar: () => void
  /** Evento nuevo: la otra entrada (fase 9.5), pegar el resultado del prompt de agenda. */
  alPegar?: () => void
  /** Evento nuevo ya creado (el chat lo anuncia en el canal, fase 9.6). */
  alCrear?: (id: number) => void
}) {
  const tema = useTheme()
  const celular = useMediaQuery(tema.breakpoints.down('sm'))
  const op = useOpcionesAgenda()
  const [b, setB] = useState<Borrador>(nuevo(isoDia(new Date()), '09:00'))
  const [evento, setEvento] = useState<EventoAgenda | null>(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [choques, setChoques] = useState<ChoqueVerificado[]>([])
  const [personas, setPersonas] = useState<PersonaDir[]>([])
  const [buscaPersona, setBuscaPersona] = useState('')
  const [otroNombre, setOtroNombre] = useState('')
  const turno = useRef(0)
  const soloLectura = op ? !op.puede_escribir : false
  // «Abrir» lo parecido que ya está: la ficha nueva pasa a ser la de ese evento.
  const [otroId, setOtroId] = useState<number | null>(null)
  const idActual = otroId ?? eventoId ?? null
  const cerrar = () => { setOtroId(null); alCerrar() }

  useEffect(() => {
    if (!abierto) return
    setError('')
    setChoques([])
    if (idActual) {
      setEvento(null)
      api<EventoAgenda>(`/api/agenda/eventos/${idActual}`).then((e) => { setEvento(e); setB(deEvento(e)) }).catch((e) => setError(mensajeError(e)))
    } else {
      setEvento(null)
      const base = nuevo(inicial?.fecha ?? isoDia(new Date()), inicial?.hora ?? '09:00')
      setB({ ...base, vinculos: inicial?.vinculos ?? [], titulo: inicial?.titulo ?? '', tipo: inicial?.tipo ?? base.tipo })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, idActual])

  const parecido = useParecido('/api/agenda/parecido', abierto && !idActual && b.titulo.trim().length >= 6 && b.fecha
    ? { titulo: b.titulo.trim(), inicio: `${b.fecha}T${b.todo_el_dia ? '00:00' : b.hora || '00:00'}:00`, todo_el_dia: b.todo_el_dia }
    : null)

  // Choques mientras se llena (con pausa: no una consulta por tecla).
  useEffect(() => {
    if (!abierto || !b.fecha || b.todo_el_dia || b.estado === 'cancelado' || b.estado === 'suspendido') {
      setChoques([])
      return
    }
    const mio = ++turno.current
    const t = window.setTimeout(() => {
      const c = cuerpo(b)
      api<{ choques: ChoqueVerificado[] }>('/api/agenda/verificar', {
        method: 'POST',
        body: JSON.stringify({ inicio: c.inicio, fin: c.fin, todo_el_dia: c.todo_el_dia, tipo: c.tipo, recurrencia: c.recurrencia, participantes: c.participantes, excluir_id: idActual }),
      }).then((r) => mio === turno.current && setChoques(r.choques)).catch(() => {})
    }, 400)
    return () => window.clearTimeout(t)
  }, [abierto, idActual, b])

  useEffect(() => {
    const q = buscaPersona.trim()
    if (q.length < 2) return setPersonas([])
    const t = window.setTimeout(() => {
      void buscarPersonas<PersonaDir>(q, 20).then(setPersonas)
    }, 250)
    return () => window.clearTimeout(t)
  }, [buscaPersona])

  const poner = <K extends keyof Borrador>(k: K, v: Borrador[K]) => setB((x) => ({ ...x, [k]: v }))
  const agregar = (p: Participante) => {
    const clave = p.usuario_id ? `u:${p.usuario_id}` : p.persona_id ? `p:${p.persona_id}` : `n:${p.nombre.toLowerCase()}`
    const ya = b.participantes.some((x) => (x.usuario_id ? `u:${x.usuario_id}` : x.persona_id ? `p:${x.persona_id}` : `n:${x.nombre.toLowerCase()}`) === clave)
    if (!ya) poner('participantes', [...b.participantes, p])
  }

  const guardar = async () => {
    if (!b.titulo.trim()) return setError('Escriba el nombre del evento.')
    if (!b.todo_el_dia && `${b.fecha_fin}T${b.hora_fin}` < `${b.fecha}T${b.hora}`) return setError('El fin no puede ser antes del inicio.')
    setOcupado(true)
    setError('')
    try {
      const datos = cuerpo(b)
      if (evento) await api(`/api/agenda/eventos/${evento.id}`, { method: 'PUT', body: JSON.stringify({ ...datos, version: evento.version }) })
      else {
        const creado = await api<{ id: number }>('/api/agenda/eventos', { method: 'POST', body: JSON.stringify(datos) })
        alCrear?.(creado.id)
      }
      avisarCambio()
      cerrar()
    } catch (e) {
      setError(mensajeError(e))
    } finally {
      setOcupado(false)
    }
  }

  const descartar = async () => {
    if (!evento) return
    try {
      await api(`/api/agenda/eventos/${evento.id}/descartar`, { method: 'POST' })
      avisarCambio()
      cerrar()
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  const omitir = async () => {
    if (!evento || !ocurrencia) return
    if (!(await confirmar(`¿Quitar solo la del ${ocurrencia.slice(8, 10)}/${ocurrencia.slice(5, 7)}? La serie sigue las demás semanas.`, { aceptar: 'Quitar', peligro: true }))) return
    try {
      await api(`/api/agenda/eventos/${evento.id}/omitir`, { method: 'POST', body: JSON.stringify({ fecha: ocurrencia }) })
      avisarCambio()
      cerrar()
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  const eliminar = async () => {
    if (!evento) return
    if (!(await confirmar(`¿Eliminar «${evento.titulo}»${evento.recurrencia ? ' y TODA su serie' : ''}? Si no se hará, márquelo cancelado.`, { aceptar: 'Eliminar', peligro: true }))) return
    try {
      await api(`/api/agenda/eventos/${evento.id}`, { method: 'DELETE' })
      avisarCambio()
      cerrar()
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  const usuarios = op?.usuarios ?? []
  return (
    <Dialog open={abierto} onClose={cerrar} maxWidth="md" fullWidth fullScreen={celular} aria-labelledby="titulo-dialogo-evento">
      <DialogTitle component="div" sx={{ display: 'flex', alignItems: 'center', pr: 1 }}>
        <Box component="h2" id="titulo-dialogo-evento" sx={{ flex: 1, m: 0, font: 'inherit' }}>{idActual ? 'Evento' : 'Nuevo evento'}</Box>
        {!idActual && alPegar && (
          <Button size="small" startIcon={<ContentPasteOutlinedIcon fontSize="small" />} onClick={alPegar} sx={{ mr: 0.5, color: 'text.secondary', fontWeight: 500 }}>Desde el prompt</Button>
        )}
        <IconButton onClick={cerrar} aria-label="Cerrar"><CloseIcon /></IconButton>
      </DialogTitle>
      {ocupado && <LinearProgress />}
      <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
        <AvisoParecido p={parecido} alAbrir={(p) => setOtroId(p.id)} />
        {/* Una SOLICITUD (por confirmar, 2026-10-18; o agendada SOLO desde un documento,
            servicios/agenda_detectada.py): no sale en el calendario hasta confirmarla. */}
        {evento?.estado === 'propuesto' && b.estado === 'propuesto' && !soloLectura && (
          <Alert
            severity="info"
            action={<Button color="inherit" size="small" onClick={() => poner('estado', 'confirmado')}>Confirmar</Button>}
          >
            {evento.origen === 'detectado' ? 'Detectada en un documento: revise la fecha y la hora.' : 'Por confirmar: aún no sale en el calendario.'}
          </Alert>
        )}
        {/* Coincidencias (2026-10-19, Edison: «ordenar, que no sea abrumador ni distractivo»): una línea
            con punto arena y, debajo, cada cruce en gris: hora primero, título corto, quién va también. */}
        {choques.length > 0 && (
          <Box sx={{ px: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 13, color: 'text.primary', fontWeight: 600 }}>
              <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: choques.some((c) => c.gravedad === 'alta') ? PALETA.dorado : PALETA.apagado, flexShrink: 0 }} />
              {choques.length === 1 ? 'Coincide con otra cosa de la agenda' : `Coincide con ${choques.length} cosas de la agenda`}
            </Box>
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: '15px', display: 'grid', gap: 0.25 }}>
              {choques.slice(0, 4).map((c) => (
                <Typography key={c.clave} component="li" variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.35 }}>
                  <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.primary' }}>{horaDe(c.desde)}–{horaDe(c.hasta)}</Box>
                  {' · '}{tituloAgenda(c.titulo)}
                  {c.comparten.length > 0 && <Box component="span" sx={{ color: 'text.disabled' }}>{` · también ${c.comparten.join(', ')}`}</Box>}
                </Typography>
              ))}
              {choques.length > 4 && <Typography component="li" variant="caption" sx={{ color: 'text.disabled' }}>y {choques.length - 4} más</Typography>}
            </Box>
          </Box>
        )}
        <TextField label="Qué" value={b.titulo} onChange={(e) => poner('titulo', e.target.value)} required autoFocus={!idActual} disabled={soloLectura} placeholder="Sesión de la comisión, reunión con un gremio, entrevista…" />
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, minmax(0, 1fr))' } }}>
          <TextField select label="Tipo" value={b.tipo} onChange={(e) => poner('tipo', e.target.value)} disabled={soloLectura}>
            {(op?.tipos ?? []).map((t) => <MenuItem key={t.clave} value={t.clave}>{t.nombre}</MenuItem>)}
          </TextField>
          <TextField select label="Estado" value={b.estado} onChange={(e) => poner('estado', e.target.value)} disabled={soloLectura}>
            {(op?.estados ?? []).map((t) => <MenuItem key={t.clave} value={t.clave}>{t.nombre}</MenuItem>)}
          </TextField>
          <FormControlLabel control={<Switch checked={b.todo_el_dia} onChange={(e) => poner('todo_el_dia', e.target.checked)} disabled={soloLectura} />} label="Todo el día" sx={{ gridColumn: { xs: '1 / -1', sm: 'span 2' } }} />
          <TextField type="date" label="Fecha" value={b.fecha} onChange={(e) => setB((x) => ({ ...x, fecha: e.target.value, fecha_fin: x.fecha_fin < e.target.value ? e.target.value : x.fecha_fin }))} InputLabelProps={{ shrink: true }} disabled={soloLectura} />
          {!b.todo_el_dia && <TextField type="time" label="Desde" value={b.hora} onChange={(e) => setB((x) => ({ ...x, hora: e.target.value, hora_fin: x.fecha_fin === x.fecha && x.hora_fin <= e.target.value ? masHora(e.target.value, 60) : x.hora_fin }))} InputLabelProps={{ shrink: true }} disabled={soloLectura} />}
          <TextField type="date" label={b.todo_el_dia ? 'Hasta el' : 'Termina el'} value={b.fecha_fin} onChange={(e) => poner('fecha_fin', e.target.value)} InputLabelProps={{ shrink: true }} disabled={soloLectura} />
          {!b.todo_el_dia && <TextField type="time" label="Hasta" value={b.hora_fin} onChange={(e) => poner('hora_fin', e.target.value)} InputLabelProps={{ shrink: true }} disabled={soloLectura} />}
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
          <TextField select size="small" label="Se repite" value={b.repetir} onChange={(e) => poner('repetir', e.target.value as Borrador['repetir'])} disabled={soloLectura} sx={{ minWidth: 180 }}>
            <MenuItem value="">No se repite</MenuItem>
            <MenuItem value="semanal">Cada semana</MenuItem>
            <MenuItem value="quincenal">Cada dos semanas</MenuItem>
            <MenuItem value="diaria">Todos los días</MenuItem>
          </TextField>
          {(b.repetir === 'semanal' || b.repetir === 'quincenal') && (
            <ToggleButtonGroup size="small" value={b.dias} onChange={(_, v: number[]) => v.length && poner('dias', v.sort())} aria-label="Días de la semana" disabled={soloLectura}>
              {DIAS_CORTOS.map((d, i) => <ToggleButton key={d} value={i} sx={{ px: 1, textTransform: 'none' }} aria-label={d}>{d}</ToggleButton>)}
            </ToggleButtonGroup>
          )}
          {b.repetir && <TextField type="date" size="small" label="Hasta (opcional)" value={b.hasta} onChange={(e) => poner('hasta', e.target.value)} InputLabelProps={{ shrink: true }} disabled={soloLectura} />}
        </Box>

        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' } }}>
          <TextField label="Lugar" value={b.lugar} onChange={(e) => poner('lugar', e.target.value)} disabled={soloLectura} placeholder="Sala, edificio, dirección o distrito" />
          <TextField select label="Modalidad" value={b.modalidad} onChange={(e) => poner('modalidad', e.target.value)} disabled={soloLectura}>
            {(op?.modalidades ?? []).map((t) => <MenuItem key={t.clave} value={t.clave}>{t.nombre}</MenuItem>)}
          </TextField>
          {b.modalidad !== 'presencial' && <TextField label="Enlace de la reunión virtual" value={b.enlace} onChange={(e) => poner('enlace', e.target.value)} disabled={soloLectura} sx={{ gridColumn: '1 / -1' }} placeholder="https://…" />}
          <TextField select size="small" label="Recordatorio" value={b.recordatorio} onChange={(e) => poner('recordatorio', e.target.value)} disabled={soloLectura} helperText={b.todo_el_dia ? 'Todo el día: se avisa la víspera a las 18:00.' : 'Aviso en la campana a quien va.'}>
            <MenuItem value="">Según el tipo (pleno y comisión: 2 h; el resto: 30 min a 1 h 30)</MenuItem>
            <MenuItem value="0">Sin recordatorio</MenuItem>
            <MenuItem value="15">15 minutos antes</MenuItem>
            <MenuItem value="30">30 minutos antes</MenuItem>
            <MenuItem value="60">1 hora antes</MenuItem>
            <MenuItem value="120">2 horas antes</MenuItem>
            <MenuItem value="1440">Un día antes</MenuItem>
          </TextField>
        </Box>

        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Quién va</Typography>
          <Box sx={{ display: 'grid', gap: 0.75, mb: 1 }}>
            {b.participantes.map((p, i) => (
              <Box key={`${p.usuario_id}-${p.persona_id}-${p.nombre}-${i}`} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ flex: 1, minWidth: 0, fontSize: 14 }} noWrap>
                  {p.nombre || usuarios.find((u) => u.id === p.usuario_id)?.nombre}
                  <Typography component="span" variant="caption" color="text.secondary"> · {p.usuario_id ? 'equipo' : p.persona_id ? 'directorio' : 'externo'}</Typography>
                </Typography>
                <TextField select size="small" value={p.rol} onChange={(e) => poner('participantes', b.participantes.map((x, j) => (j === i ? { ...x, rol: e.target.value } : x)))} disabled={soloLectura} sx={{ width: 140 }} inputProps={{ 'aria-label': 'Papel' }}>
                  {(op?.roles ?? []).map((r) => <MenuItem key={r.clave} value={r.clave}>{r.nombre}</MenuItem>)}
                </TextField>
                {!soloLectura && <IconButton size="small" onClick={() => poner('participantes', b.participantes.filter((_, j) => j !== i))} aria-label="Quitar"><CloseIcon fontSize="small" /></IconButton>}
              </Box>
            ))}
          </Box>
          {!soloLectura && (
            <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' } }}>
              <Autocomplete
                size="small"
                options={usuarios}
                getOptionLabel={(u) => u.nombre}
                value={null}
                onChange={(_, u) => u && agregar({ usuario_id: u.id, persona_id: null, nombre: u.nombre, rol: 'acompana', confirmado: false })}
                renderInput={(params) => <TextField {...params} label="Del equipo" />}
                blurOnSelect
              />
              <Autocomplete
                size="small"
                options={personas}
                filterOptions={(x) => x}
                getOptionLabel={(p) => p.nombre}
                value={null}
                inputValue={buscaPersona}
                onInputChange={(_, v, motivo) => motivo !== 'reset' && setBuscaPersona(v)}
                onChange={(_, p) => { if (p) { agregar({ usuario_id: null, persona_id: p.id, nombre: p.nombre, rol: 'invitado', confirmado: false }); setBuscaPersona('') } }}
                renderOption={(props, p) => <li {...props} key={p.id}><Box><Typography sx={{ fontSize: 14 }}>{p.nombre}</Typography><Typography variant="caption" color="text.secondary">{p.cargo}</Typography></Box></li>}
                noOptionsText={buscaPersona.trim().length < 2 ? 'Escriba un nombre' : 'Sin resultados'}
                renderInput={(params) => <TextField {...params} label="Del directorio" />}
                blurOnSelect
              />
              <TextField
                size="small"
                label="Otra persona (nombre)"
                value={otroNombre}
                onChange={(e) => setOtroNombre(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && otroNombre.trim()) {
                    e.preventDefault()
                    agregar({ usuario_id: null, persona_id: null, nombre: otroNombre.trim(), rol: 'invitado', confirmado: false })
                    setOtroNombre('')
                  }
                }}
                helperText="Enter para agregar"
              />
            </Box>
          )}
          <TextField select size="small" label="Responsable de organizarlo" value={b.responsable_id ?? ''} onChange={(e) => poner('responsable_id', e.target.value === '' ? null : Number(e.target.value))} disabled={soloLectura} sx={{ mt: 1.5, minWidth: 260 }}>
            <MenuItem value=""><em>Nadie en particular</em></MenuItem>
            {usuarios.map((u) => <MenuItem key={u.id} value={u.id}>{u.nombre}</MenuItem>)}
          </TextField>
        </Box>
        <SelectorVinculos valor={b.vinculos} alCambiar={(v) => poner('vinculos', v)} deshabilitado={soloLectura} />
        <TextField label="Notas" value={b.descripcion} onChange={(e) => poner('descripcion', e.target.value)} multiline minRows={2} maxRows={8} disabled={soloLectura} placeholder="Agenda de la sesión, qué llevar, punto de encuentro…" />
        {evento && lineaAutoria(evento) && (
          <Typography
            variant="caption"
            title={[evento.creado_en && `Creada: ${new Date(evento.creado_en).toLocaleString('es-PE')}`, evento.actualizado_en && `Última edición: ${new Date(evento.actualizado_en).toLocaleString('es-PE')}`].filter(Boolean).join('\n')}
            sx={{ color: 'text.disabled', fontSize: 11.5, mt: -0.5 }}
          >
            {lineaAutoria(evento)}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2, flexWrap: 'wrap', gap: 1 }}>
        {evento && !soloLectura && (
          <Box sx={{ mr: 'auto', display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={() => void eliminar()}>Eliminar</Button>
            {evento.estado === 'propuesto' && <Button color="inherit" onClick={() => void descartar()} sx={{ color: 'text.secondary' }}>Descartar</Button>}
            {evento.recurrencia && ocurrencia && <Button startIcon={<EventBusyOutlinedIcon />} onClick={() => void omitir()}>Omitir solo esta fecha</Button>}
          </Box>
        )}
        <Button onClick={cerrar}>{soloLectura ? 'Cerrar' : 'Cancelar'}</Button>
        {!soloLectura && (
          <Button variant="contained" onClick={() => void guardar()} disabled={ocupado || !b.titulo.trim()}>
            {idActual
              ? evento?.estado === 'propuesto' && b.estado === 'confirmado' ? 'Confirmar' : evento?.recurrencia ? 'Guardar la serie' : 'Guardar'
              : b.estado === 'propuesto' ? 'Guardar por confirmar' : 'Agendar'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
