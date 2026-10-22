/**
 * PEGAR UN PLAN DE TAREAS (2026-10-12): el resultado del prompt de plan de tareas (bloque
 * `plan-de-tareas`, de notas sueltas, un acta, un correo o un audio transcrito) →
 * `POST /api/tareas/pegar` devuelve cada tarea lista, con el responsable casado con el equipo
 * y la que ya existe (mismo título y vencimiento) marcada → la persona marca y corrige el
 * responsable → se crean por `POST /api/tareas` (y `POST /api/tareas/listas` para una lista que
 * aún no existe). Constancia en `pegados`, una por tarea creada. Nada se crea sin marcar.
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
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import LinearProgress from '@mui/material/LinearProgress'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import { api, PALETA } from '@qillqa/tiqsi'
import { mensajePegado, registrarPegado, type LecturaPegado, usePausaTrasLeer } from './apoyo'
import { avisarCambio, mensajeError, olvidarOpciones, useOpcionesTareas } from './datos'
import { COLOR_PRIORIDAD, type Prioridad } from './tipos'

interface TareaLista {
  titulo: string; descripcion: string; estado: string; prioridad: Prioridad; importante: boolean
  responsable_id: number | null; vence_fecha: string | null; vence_hora: string | null; lista_id: number | null
  etiquetas: string[]; checklist: { id: string; texto: string; hecha: boolean }[]; vinculos: string[]
}
interface FilaPlan {
  n: number
  tarea: TareaLista
  responsable_texto: string
  responsable_nombre: string
  responsable_sin_casar: boolean
  lista_nueva: string
  existente: { id: number; titulo: string; estado: string; estado_nombre: string } | null
  avisos: string[]
  dudas: Record<string, { valor: string; opciones: string[] }>
  estado: 'nuevo' | 'existente'
}
interface Vista { lectura: LecturaPegado; tareas: FilaPlan[]; observaciones: string[] }

const plazo = (f: string | null, h: string | null) => {
  if (!f) return 'Sin plazo'
  const d = new Date(`${f}T12:00:00`)
  return d.toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: '2-digit' }) + (h ? ` ${h}` : '')
}

export default function DialogoPegarTareas({ abierto, alCerrar, alRegistrado, textoInicial, vinculo }: {
  abierto: boolean
  alCerrar: () => void
  /** Tras registrar: los id de las tareas creadas. */
  alRegistrado: (ids: number[]) => void
  /** Texto que llega ya pegado (del chat): se lee solo al abrir. */
  textoInicial?: string
  /** Identificador al que se vinculan todas (`doc:12`, `pl:3`…), si se pega desde allí. */
  vinculo?: string
}) {
  const tema = useTheme()
  const celular = useMediaQuery(tema.breakpoints.down('sm'))
  const op = useOpcionesTareas()
  const navegar = useNavigate()
  const [texto, setTexto] = useState('')
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState('')
  const [v, setV] = useState<Vista | null>(null)
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set())
  const [responsables, setResponsables] = useState<Record<number, number | ''>>({})
  const [guardando, setGuardando] = useState(false)

  const cerrar = () => { setTexto(''); setV(null); setError(''); alCerrar() }

  const leer = async (t: string = texto) => {
    setLeyendo(true)
    setError('')
    try {
      const r = await api<Vista>('/api/tareas/pegar', { method: 'POST', body: JSON.stringify({ texto: t, vinculos: vinculo ? [vinculo] : [] }) })
      setV(r)
      setMarcadas(new Set(r.tareas.filter((f) => f.estado === 'nuevo').map((f) => f.n)))
      setResponsables(Object.fromEntries(r.tareas.map((f) => [f.n, f.tarea.responsable_id ?? ''])))
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

  const registrar = async () => {
    if (!v) return
    setGuardando(true)
    setError('')
    const fallos: string[] = []
    const ids: number[] = []
    const elegidas = v.tareas.filter((f) => marcadas.has(f.n))
    // Las listas que el plan nombra y aún no existen se crean una vez.
    const listasNuevas: Record<string, number> = {}
    for (const nombre of [...new Set(elegidas.map((f) => f.lista_nueva).filter(Boolean))]) {
      try {
        const l = await api<{ id: number }>('/api/tareas/listas', { method: 'POST', body: JSON.stringify({ nombre }) })
        listasNuevas[nombre] = l.id
      } catch (e) {
        fallos.push(`lista «${nombre}»: ${mensajeError(e)}`)
      }
    }
    if (Object.keys(listasNuevas).length) olvidarOpciones()
    for (const f of elegidas) {
      const cuerpo: TareaLista = {
        ...f.tarea,
        responsable_id: responsables[f.n] === '' || responsables[f.n] === undefined ? null : Number(responsables[f.n]),
        lista_id: f.tarea.lista_id ?? (f.lista_nueva ? listasNuevas[f.lista_nueva] ?? null : null),
      }
      try {
        const creada = await api<{ id: number }>('/api/tareas', { method: 'POST', body: JSON.stringify(cuerpo) })
        ids.push(creada.id)
        void registrarPegado({
          tipo: v.lectura.tipo, version: v.lectura.version, fuente: v.lectura.fuente, texto, entidad: `tarea:${creada.id}`,
          campos_propuestos: f.tarea as unknown as Record<string, unknown>, campos_aplicados: cuerpo as unknown as Record<string, unknown>,
          rechazados: cuerpo.responsable_id !== f.tarea.responsable_id ? ['responsable_id'] : [],
        })
      } catch (e) {
        fallos.push(`${f.tarea.titulo.slice(0, 60)}: ${mensajeError(e)}`)
      }
    }
    setGuardando(false)
    avisarCambio()
    if (ids.length) alRegistrado(ids)
    if (fallos.length) setError(`No se registró: ${fallos.join('; ')}`)
    else cerrar()
  }

  const alternar = (n: number) => setMarcadas((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x })
  const usuarios = op?.usuarios ?? []
  const listas = op?.listas ?? []

  const pausa = usePausaTrasLeer(Boolean(v))
  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="sm" scroll="paper" fullScreen={celular}>
      <DialogTitle>Pegar tareas</DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, px: { xs: 1.5, sm: 3 } }}>
        {!v && (
          <>
            <Typography variant="body2" color="text.secondary">
              Pegue aquí la respuesta de la IA con las tareas.
            </Typography>
            <TextField multiline minRows={6} maxRows={16} autoFocus size="small" value={texto} onChange={(e) => setTexto(e.target.value)} label="Respuesta de la IA" />
            {leyendo && <LinearProgress />}
          </>
        )}
        {v && (
          <>
            {/* Lo que no casó con el vocabulario se dice en su tarjeta, no dos veces. */}
            {v.lectura.avisos.filter((a) => !a.endsWith('elija uno.')).map((a) => <Alert key={a} severity="info" sx={{ py: 0 }}>{a}</Alert>)}
            {v.tareas.length === 0 && <Alert severity="warning" sx={{ py: 0 }}>El bloque no trae tareas.</Alert>}
            {v.tareas.map((f) => {
              const t = f.tarea
              const lista = t.lista_id ? listas.find((l) => l.id === t.lista_id)?.nombre : f.lista_nueva ? `${f.lista_nueva} (nueva)` : ''
              const marcada = marcadas.has(f.n)
              return (
                <Box key={f.n} sx={{ display: 'flex', gap: 0.5, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: PALETA.superficieTenue, opacity: marcada ? 1 : 0.6 }}>
                  <Checkbox size="small" checked={marcada} onChange={() => alternar(f.n)} sx={{ p: 0.25, alignSelf: 'flex-start' }} inputProps={{ 'aria-label': `Registrar ${t.titulo}` }} />
                  <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{t.titulo}</Typography>
                      <Chip size="small" label={f.estado === 'existente' ? 'ya existe' : 'nueva'} sx={{ height: 20, fontSize: 11, flexShrink: 0, bgcolor: f.estado === 'nuevo' ? PALETA.exitoFondo : PALETA.avisoFondo }} />
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1 }}>
                      <span>{plazo(t.vence_fecha, t.vence_hora)}</span>
                      {t.prioridad !== 'normal' && <Box component="span" sx={{ color: COLOR_PRIORIDAD[t.prioridad], fontWeight: 600 }}>{t.prioridad}</Box>}
                      {lista && <span>{lista}</span>}
                      {t.checklist.length > 0 && <span>{t.checklist.length} pasos</span>}
                      {t.etiquetas.length > 0 && <span>{t.etiquetas.map((e) => `#${e}`).join(' ')}</span>}
                    </Typography>
                    {t.descripcion && <Typography variant="caption" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.descripcion}</Typography>}
                    <TextField
                      select
                      size="small"
                      value={responsables[f.n] ?? ''}
                      onChange={(e) => setResponsables((r) => ({ ...r, [f.n]: e.target.value === '' ? '' : Number(e.target.value) }))}
                      SelectProps={{ displayEmpty: true }}
                      inputProps={{ 'aria-label': `Responsable de ${t.titulo}` }}
                      sx={{ maxWidth: { sm: 280 }, '& .MuiSelect-select': { py: 0.6, fontSize: 13.5 }, bgcolor: 'background.paper' }}
                    >
                      <MenuItem value="">Sin responsable</MenuItem>
                      {usuarios.map((u) => <MenuItem key={u.id} value={u.id}>{u.nombre}</MenuItem>)}
                    </TextField>
                    {f.responsable_sin_casar && (responsables[f.n] ?? '') === '' && <Typography variant="caption" sx={{ color: PALETA.dorado }}>«{f.responsable_texto}» no casa con una sola persona del equipo: elíjala.</Typography>}
                    {f.existente && (
                      // 2026-10-18: parecida (no solo igual): se dice cuál y se puede abrir antes de crear otra.
                      <Typography variant="caption" color="text.secondary">
                        Ya existe «{f.existente.titulo}» ({f.existente.estado_nombre}).{' '}
                        <Link component="button" type="button" variant="caption" onClick={() => { cerrar(); navegar(`/tareas?abrir=${f.existente!.id}`) }}>Abrir</Link>
                      </Typography>
                    )}
                    {f.avisos.map((a) => <Typography key={a} variant="caption" sx={{ color: PALETA.dorado }}>{a}</Typography>)}
                    {Object.entries(f.dudas).map(([k, d]) => <Typography key={k} variant="caption" sx={{ color: PALETA.dorado }}>{k === 'prioridad' ? 'Prioridad' : k} «{d.valor}» no se reconoce: queda normal.</Typography>)}
                  </Box>
                </Box>
              )
            })}
            {v.observaciones.length > 0 && (
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>Observaciones</Typography>
                {v.observaciones.map((o) => <Typography key={o} variant="caption" color="text.secondary" sx={{ display: 'block' }}>{o}</Typography>)}
              </Box>
            )}
          </>
        )}
        {error && <Alert severity="error" sx={{ py: 0 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={cerrar}>Cancelar</Button>
        {v && <Button color="inherit" onClick={() => setV(null)}>Volver a pegar</Button>}
        {!v
          ? <Button variant="contained" disabled={!texto.trim() || leyendo} onClick={() => void leer()}>Leer</Button>
          : <Button variant="contained" disabled={guardando || marcadas.size === 0 || pausa} onClick={() => void registrar()}>Registrar {marcadas.size ? `(${marcadas.size})` : ''}</Button>}
      </DialogActions>
    </Dialog>
  )
}
