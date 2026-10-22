/**
 * ALTA RÁPIDA al modo de Todoist: una línea en lenguaje natural («revisar PL mañana
 * 15:00 @cuenta !alta #comision») y Enter. Mientras se escribe, el servidor dice qué
 * entendió (plazo, responsable, prioridad, etiquetas) para corregir antes de crear;
 * la interpretación vive en un solo lugar (backend/app/servicios/tareas_reglas.py).
 * Sin @cuenta, la tarea es de quien la escribe. Si ya hay una parecida, lo dice y deja abrirla
 * antes de crear otra (2026-10-18).
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import InputAdornment from '@mui/material/InputAdornment'
import IconButton from '@mui/material/IconButton'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddTaskIcon from '@mui/icons-material/AddTask'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import { api, esSinServidor } from '@qillqa/tiqsi'
import { guardarSinConexion, avisoBreve, SE_GUARDARA, hoyIso } from './apoyo'
import EnEsperaLista, { useEnEspera } from './EnEspera'
import { avisarCambio, mensajeError } from './datos'
import { isoDia, textoPlazo } from './calendario'
import { COLOR_PRIORIDAD, type Prioridad, type Tarea } from './tipos'
import AvisoParecido, { type Parecido } from './AvisoParecido'

interface Interpretacion {
  titulo: string
  fecha: string | null
  hora: string | null
  responsable: string | null
  responsable_nombre: string
  prioridad: Prioridad | null
  etiquetas: string[]
  avisos: string[]
}

const AYUDA = 'Ej.: «mañana 15:00 @cuenta !alta #etiqueta». Enter la crea.'

export default function AltaRapida({ vinculos = [], listaId, alCrear, autoFocus }: { vinculos?: string[]; listaId?: number | null; alCrear?: (t: Tarea) => void; autoFocus?: boolean }) {
  const [texto, setTexto] = useState('')
  const [vista, setVista] = useState<Interpretacion | null>(null)
  const [parecida, setParecida] = useState<Parecido | null>(null)
  const navegar = useNavigate()
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const turno = useRef(0)
  // En el celular el ejemplo completo no cabe en el campo: se muestra uno corto (el largo sigue en la ayuda).
  const celular = useMediaQuery(useTheme().breakpoints.down('sm'))
  // Tareas creadas sin servidor (2026-10-18): esperan en la cola y se ven aquí hasta que salen.
  const rapidasEnEspera = useEnEspera('/api/tareas/rapida', undefined, avisarCambio)
  const altasEnEspera = useEnEspera('/api/tareas', undefined, avisarCambio)

  useEffect(() => {
    if (!texto.trim()) {
      setVista(null)
      setParecida(null)
      return
    }
    const mio = ++turno.current
    const t = window.setTimeout(() => {
      api<{ interpretacion: Interpretacion; parecida?: Parecido | null }>('/api/tareas/rapida', { method: 'POST', body: JSON.stringify({ texto, vista_previa: true }) })
        .then((r) => { if (mio === turno.current) { setVista(r.interpretacion); setParecida(r.parecida ?? null) } })
        .catch(() => {})
    }, 220)
    return () => window.clearTimeout(t)
  }, [texto])

  const crear = async () => {
    if (!texto.trim() || ocupado) return
    setOcupado(true)
    setError('')
    // `escrito_el`: «mañana» es mañana respecto del día en que se escribió, aunque salga después.
    const cuerpo = JSON.stringify({ texto, vinculos, lista_id: listaId ?? null, escrito_el: hoyIso() })
    try {
      const r = await api<{ tarea: Tarea }>('/api/tareas/rapida', { method: 'POST', body: cuerpo })
      setTexto('')
      setVista(null)
      setParecida(null)
      avisarCambio()
      alCrear?.(r.tarea)
    } catch (e) {
      if (esSinServidor(e) && guardarSinConexion('/api/tareas/rapida', cuerpo, `Tarea: ${texto.trim().slice(0, 40)}`, 'tarea')) {
        setTexto('')
        setVista(null)
        avisoBreve(SE_GUARDARA)
        return
      }
      setError(mensajeError(e))
    } finally {
      setOcupado(false)
    }
  }

  const hoy = isoDia(new Date())
  return (
    <Box>
      <TextField
        fullWidth
        size="small"
        value={texto}
        autoFocus={autoFocus}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void crear()
          }
        }}
        placeholder={celular ? 'Ej.: revisar PL mañana 15:00' : 'Nueva tarea: revisar PL mañana 15:00 @cuenta !alta #comision'}
        disabled={ocupado}
        inputProps={{ 'aria-label': 'Nueva tarea en lenguaje natural', enterKeyHint: 'done' }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Tooltip title={AYUDA}><HelpOutlineIcon sx={{ fontSize: 18, color: 'text.disabled', cursor: 'help' }} /></Tooltip>
            </InputAdornment>
          ),
          endAdornment: (
            <InputAdornment position="end">
              <IconButton edge="end" color="primary" onClick={() => void crear()} disabled={!texto.trim() || ocupado} aria-label="Crear tarea">
                <AddTaskIcon />
              </IconButton>
            </InputAdornment>
          ),
          sx: { bgcolor: 'background.paper', borderRadius: 2 },
        }}
      />
      {(vista || error) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, mt: 0.75, minHeight: 24 }}>
          {vista && (
            <>
              <Typography variant="caption" color="text.secondary" sx={{ mr: 0.25 }}>
                {vista.titulo ? `«${vista.titulo}»` : 'Falta qué hay que hacer'}
              </Typography>
              {vista.fecha && <Chip size="small" icon={<EventOutlinedIcon sx={{ fontSize: '15px !important' }} />} label={textoPlazo(vista.fecha, vista.hora, hoy)} sx={{ height: 22, fontSize: 12 }} />}
              <Chip size="small" icon={<PersonOutlineIcon sx={{ fontSize: '15px !important' }} />} label={vista.responsable_nombre} sx={{ height: 22, fontSize: 12 }} />
              {vista.prioridad && vista.prioridad !== 'normal' && (
                <Chip size="small" icon={<FlagOutlinedIcon sx={{ fontSize: '15px !important', color: `${COLOR_PRIORIDAD[vista.prioridad]} !important` }} />} label={vista.prioridad} sx={{ height: 22, fontSize: 12 }} />
              )}
              {vista.etiquetas.map((e) => <Chip key={e} size="small" label={`#${e}`} variant="outlined" sx={{ height: 22, fontSize: 12 }} />)}
              {vista.avisos.map((a) => <Typography key={a} variant="caption" sx={{ color: 'warning.dark' }}>{a}</Typography>)}
            </>
          )}
          {error && <Typography variant="caption" color="error">{error}</Typography>}
        </Box>
      )}
      {parecida && <Box sx={{ mt: 0.75 }}><AvisoParecido p={parecida} alAbrir={(p) => { setTexto(''); navegar(`/tareas?abrir=${p.id}`) }} /></Box>}
      <EnEsperaLista lista={rapidasEnEspera} />
      <EnEsperaLista lista={altasEnEspera} campo="titulo" />
    </Box>
  )
}
