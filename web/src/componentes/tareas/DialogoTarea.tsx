/**
 * Ficha de una TAREA: crear o editar (título, qué hay que hacer, responsable único,
 * plazo con hora, prioridad, estado, lista, etiquetas, lista de verificación, vínculos
 * y entregable al cerrar) y, si ya existe, su conversación con la bitácora de cambios.
 * En el celular ocupa la pantalla entera. Al crear, avisa si ya hay una parecida y deja abrirla
 * (2026-10-18); la clase (interna o externa) la decide el sistema salvo que se elija.
 */
import { useCallback, useEffect, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import Autocomplete from '@mui/material/Autocomplete'
import Chip from '@mui/material/Chip'
import Alert from '@mui/material/Alert'
import Divider from '@mui/material/Divider'
import LinearProgress from '@mui/material/LinearProgress'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/Close'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SendIcon from '@mui/icons-material/Send'
import { api, esSinServidor, confirmar } from '@qillqa/tiqsi'
import { guardarSinConexion, avisoBreve, SE_GUARDARA } from './apoyo'
import EnEsperaLista, { useEnEspera } from './EnEspera'
import { avisarCambio, mensajeError, olvidarOpciones, tareaVista, useOpcionesTareas } from './datos'
import SelectorVinculos from './SelectorVinculos'
import AvisoParecido, { useParecido } from './AvisoParecido'
import { ESTADOS_TAREA, PRIORIDADES, type EstadoTarea, type Prioridad, type PuntoLista, type Tarea, type Vinculo } from './tipos'

interface Borrador {
  titulo: string
  descripcion: string
  estado: EstadoTarea
  prioridad: Prioridad
  importante: boolean
  responsable_id: number | null
  vence_fecha: string
  vence_hora: string
  lista_id: number | null
  etiquetas: string[]
  checklist: PuntoLista[]
  vinculos: Vinculo[]
  entregable: string
  clase: '' | 'interna' | 'externa'
}

const VACIO: Borrador = {
  titulo: '', descripcion: '', estado: 'por_hacer', prioridad: 'normal', importante: false, responsable_id: null,
  vence_fecha: '', vence_hora: '', lista_id: null, etiquetas: [], checklist: [], vinculos: [], entregable: '', clase: '',
}

const deTarea = (t: Tarea): Borrador => ({
  titulo: t.titulo, descripcion: t.descripcion, estado: t.estado, prioridad: t.prioridad, importante: Boolean(t.importante), responsable_id: t.responsable_id,
  vence_fecha: t.vence_fecha ?? '', vence_hora: t.vence_hora ?? '', lista_id: t.lista_id, etiquetas: t.etiquetas,
  checklist: t.checklist, vinculos: t.vinculos, entregable: t.entregable, clase: t.clase_elegida ?? '',
})

const hace = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`
}

export default function DialogoTarea({
  abierto, tareaId, inicial, alCerrar, alGuardar,
}: {
  abierto: boolean
  /** Editar esta tarea; sin id, crear. */
  tareaId?: number | null
  /** Valores con que nace una tarea nueva (p. ej. el vínculo al documento abierto). */
  inicial?: Partial<Borrador>
  alCerrar: () => void
  alGuardar?: (t: Tarea) => void
}) {
  const tema = useTheme()
  const celular = useMediaQuery(tema.breakpoints.down('sm'))
  const op = useOpcionesTareas()
  const [b, setB] = useState<Borrador>(VACIO)
  const [tarea, setTarea] = useState<Tarea | null>(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [nuevoPunto, setNuevoPunto] = useState('')
  const [comentario, setComentario] = useState('')
  const soloLectura = op ? !op.puede_escribir : false
  // «Abrir» la parecida que ya está: la ficha nueva pasa a ser la de esa tarea.
  const [otroId, setOtroId] = useState<number | null>(null)
  const idActual = otroId ?? tareaId ?? null
  const cerrar = () => { setOtroId(null); alCerrar() }

  const leer = useCallback(async (id: number) => {
    const t = await api<Tarea>(`/api/tareas/${id}`).catch((e: unknown) => {
      // Sin servidor y sin copia de la ficha: lo que la lista ya sabe de ella (2026-10-18).
      const vista = esSinServidor(e) ? tareaVista(id) : undefined
      if (!vista) throw e
      return vista
    })
    setTarea(t)
    setB(deTarea(t))
  }, [])

  useEffect(() => {
    if (!abierto) return
    setError('')
    setNuevoPunto('')
    setComentario('')
    if (idActual) {
      setTarea(null)
      leer(idActual).catch((e) => setError(mensajeError(e)))
    } else {
      setTarea(null)
      setB({ ...VACIO, responsable_id: op?.yo ?? null, ...inicial })
    }
    // `inicial` se toma solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, idActual, leer])

  const parecida = useParecido('/api/tareas/parecida', abierto && !idActual && b.titulo.trim().length >= 8
    ? { titulo: b.titulo.trim(), vence_fecha: b.vence_fecha || null }
    : null)

  useEffect(() => {
    if (abierto && !idActual && op && b.responsable_id === null && !inicial?.responsable_id) setB((x) => ({ ...x, responsable_id: op.yo }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op])

  const poner = <K extends keyof Borrador>(k: K, v: Borrador[K]) => setB((x) => ({ ...x, [k]: v }))

  const guardar = async () => {
    if (!b.titulo.trim()) return setError('Escriba qué hay que hacer.')
    setOcupado(true)
    setError('')
    try {
      const cuerpo = {
        titulo: b.titulo.trim(), descripcion: b.descripcion, estado: b.estado, prioridad: b.prioridad, importante: b.importante,
        etiquetas: b.etiquetas, checklist: b.checklist, vinculos: b.vinculos.map((v) => v.id), clase: b.clase,
      }
      let t: Tarea
      if (tarea) {
        t = await api<Tarea>(`/api/tareas/${tarea.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...cuerpo,
            version: tarea.version,
            ...(b.responsable_id ? { responsable_id: b.responsable_id } : { quitar_responsable: true }),
            ...(b.vence_fecha ? { vence_fecha: b.vence_fecha, vence_hora: b.vence_hora || null } : { quitar_plazo: true }),
            ...(b.lista_id ? { lista_id: b.lista_id } : { quitar_lista: true }),
            entregable: b.entregable,
          }),
        })
      } else {
        const alta = JSON.stringify({
          ...cuerpo, responsable_id: b.responsable_id, lista_id: b.lista_id,
          vence_fecha: b.vence_fecha || null, vence_hora: b.vence_hora || null,
        })
        try {
          t = await api<Tarea>('/api/tareas', { method: 'POST', body: alta })
        } catch (e) {
          // Sin servidor (2026-10-18): la tarea nueva espera en la cola del anfitrión y sale sola al volver.
          if (!esSinServidor(e) || !guardarSinConexion('/api/tareas', alta, `Tarea: ${cuerpo.titulo.slice(0, 40)}`, 'tarea')) throw e
          avisoBreve(SE_GUARDARA)
          cerrar()
          return
        }
      }
      if (b.etiquetas.some((e) => !op?.etiquetas.includes(e))) olvidarOpciones()
      avisarCambio()
      alGuardar?.(t)
      cerrar()
    } catch (e) {
      setError(mensajeError(e))
      if (tarea && (e as { estado?: number }).estado === 409) await leer(tarea.id).catch(() => {})
    } finally {
      setOcupado(false)
    }
  }

  const eliminar = async () => {
    if (!tarea || !(await confirmar(`¿Eliminar «${tarea.titulo}»? Si no se hará, márquela cancelada.`, { aceptar: 'Eliminar', peligro: true }))) return
    try {
      await api(`/api/tareas/${tarea.id}`, { method: 'DELETE' })
      avisarCambio()
      cerrar()
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  const rutaComentarios = `/api/tareas/${tarea?.id ?? 0}/comentarios`
  const comentariosEnEspera = useEnEspera(rutaComentarios, undefined, () => void (tarea && leer(tarea.id).catch(() => {})))
  const comentar = async () => {
    if (!tarea || !comentario.trim()) return
    const cuerpo = JSON.stringify({ texto: comentario.trim() })
    try {
      await api(rutaComentarios, { method: 'POST', body: cuerpo })
      setComentario('')
      await leer(tarea.id)
    } catch (e) {
      // Sin servidor (2026-10-18): el comentario espera en la cola del anfitrión y se ve «En espera».
      if (esSinServidor(e) && guardarSinConexion(rutaComentarios, cuerpo, `Comentario en «${tarea.titulo.slice(0, 40)}»`, 'comentario')) {
        setComentario('')
        avisoBreve(SE_GUARDARA)
        return
      }
      setError(mensajeError(e))
    }
  }

  const agregarPunto = () => {
    const texto = nuevoPunto.trim()
    if (!texto) return
    poner('checklist', [...b.checklist, { id: `c${Date.now().toString(36)}`, texto, hecha: false }])
    setNuevoPunto('')
  }

  const hechos = b.checklist.filter((c) => c.hecha).length
  const documentosVinculados = b.vinculos.filter((v) => v.id.startsWith('doc:'))
  const puedeEliminar = tarea && !soloLectura && (tarea.creado_por === op?.yo || localStorage.getItem('qillqa_rol') === 'administrador')

  return (
    <Dialog open={abierto} onClose={cerrar} maxWidth="md" fullWidth fullScreen={celular} aria-labelledby="titulo-dialogo-tarea">
      <DialogTitle id="titulo-dialogo-tarea" sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1 }}>{idActual ? 'Tarea' : 'Nueva tarea'}</Box>
        {tarea?.creado_por_nombre && (
          <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
            Encargada por {tarea.creado_por_nombre} · {hace(tarea.creado_en)}
          </Typography>
        )}
        <IconButton onClick={cerrar} aria-label="Cerrar"><CloseIcon /></IconButton>
      </DialogTitle>
      {ocupado && <LinearProgress />}
      <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
        <AvisoParecido p={parecida} alAbrir={(p) => setOtroId(p.id)} />
        <TextField
          label="Qué hay que hacer"
          value={b.titulo}
          onChange={(e) => poner('titulo', e.target.value)}
          autoFocus={!idActual}
          required
          disabled={soloLectura}
          placeholder="Revisar el proyecto de ley, responder el oficio, agendar la reunión…"
          inputProps={{ maxLength: 1000 }}
        />
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, minmax(0, 1fr))' } }}>
          <TextField select label="Responsable" value={b.responsable_id ?? ''} onChange={(e) => poner('responsable_id', e.target.value === '' ? null : Number(e.target.value))} disabled={soloLectura} sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
            <MenuItem value=""><em>Sin responsable</em></MenuItem>
            {op?.usuarios.map((u) => <MenuItem key={u.id} value={u.id}>{u.nombre}</MenuItem>)}
          </TextField>
          <TextField type="date" label="Plazo" value={b.vence_fecha} onChange={(e) => poner('vence_fecha', e.target.value)} InputLabelProps={{ shrink: true }} disabled={soloLectura} />
          <TextField type="time" label="Hora" value={b.vence_hora} onChange={(e) => poner('vence_hora', e.target.value)} InputLabelProps={{ shrink: true }} disabled={soloLectura || !b.vence_fecha} helperText={b.vence_fecha && !b.vence_hora ? 'Sin hora: todo el día' : ' '} />
          <TextField select label="Prioridad" value={b.prioridad} onChange={(e) => poner('prioridad', e.target.value as Prioridad)} disabled={soloLectura}>
            {PRIORIDADES.map((p) => (
              <MenuItem key={p.clave} value={p.clave}>
                <Box component="span" sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: p.color, display: 'inline-block', mr: 1 }} />{p.nombre}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            sx={{ gridColumn: { xs: '1 / -1', sm: 'span 3' }, mt: { xs: -1, sm: 0 } }}
            control={<Switch checked={b.importante} onChange={(e) => poner('importante', e.target.checked)} disabled={soloLectura} />}
            label={<Typography variant="body2">Importante <Typography component="span" variant="caption" color="text.secondary">— la matriz la ordena sola con su plazo</Typography></Typography>}
          />
          <TextField select size="small" label="Clase" value={b.clase} onChange={(e) => poner('clase', e.target.value as Borrador['clase'])} disabled={soloLectura} sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
            <MenuItem value="">Automática{tarea?.clase && !b.clase ? ` (${tarea.clase})` : ''}</MenuItem>
            <MenuItem value="interna">Interna (trámite)</MenuItem>
            <MenuItem value="externa">Externa (reunión, agenda)</MenuItem>
          </TextField>
          <TextField select label="Estado" value={b.estado} onChange={(e) => poner('estado', e.target.value as EstadoTarea)} disabled={soloLectura}>
            {ESTADOS_TAREA.map((s) => (
              <MenuItem key={s.clave} value={s.clave}>
                <Box component="span" sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: s.color, display: 'inline-block', mr: 1 }} />{s.nombre}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Lista" value={b.lista_id ?? ''} onChange={(e) => poner('lista_id', e.target.value === '' ? null : Number(e.target.value))} disabled={soloLectura}>
            <MenuItem value=""><em>Sin lista</em></MenuItem>
            {op?.listas.filter((l) => !l.archivada || l.id === b.lista_id).map((l) => <MenuItem key={l.id} value={l.id}>{l.nombre}</MenuItem>)}
          </TextField>
          <Autocomplete
            multiple
            freeSolo
            options={op?.etiquetas ?? []}
            value={b.etiquetas}
            onChange={(_, v) => poner('etiquetas', v.map((x) => String(x).trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))}
            disabled={soloLectura}
            sx={{ gridColumn: { xs: '1 / -1', sm: 'span 2' } }}
            renderTags={(v, props) => v.map((x, i) => { const { key, ...r } = props({ index: i }); return <Chip key={key} {...r} size="small" label={`#${x}`} /> })}
            renderInput={(params) => <TextField {...params} label="Etiquetas" placeholder="comisión, prensa…" />}
          />
        </Box>
        <TextField label="Detalle" value={b.descripcion} onChange={(e) => poner('descripcion', e.target.value)} multiline minRows={2} maxRows={10} disabled={soloLectura} placeholder="Qué se espera, a quién preguntar, de dónde sacar los datos…" />
        <SelectorVinculos valor={b.vinculos} alCambiar={(v) => poner('vinculos', v)} deshabilitado={soloLectura} />

        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Lista de verificación {b.checklist.length > 0 && <Typography component="span" variant="caption" color="text.secondary">· {hechos} de {b.checklist.length}</Typography>}
          </Typography>
          {b.checklist.length > 0 && <LinearProgress variant="determinate" value={(hechos / b.checklist.length) * 100} sx={{ mb: 1, height: 4, borderRadius: 2 }} />}
          {b.checklist.map((c, i) => (
            <Box key={c.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Checkbox size="small" checked={c.hecha} disabled={soloLectura} onChange={(e) => poner('checklist', b.checklist.map((x, j) => (j === i ? { ...x, hecha: e.target.checked } : x)))} inputProps={{ 'aria-label': c.texto }} />
              <TextField
                variant="standard"
                fullWidth
                value={c.texto}
                disabled={soloLectura}
                onChange={(e) => poner('checklist', b.checklist.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))}
                InputProps={{ disableUnderline: true, sx: { textDecoration: c.hecha ? 'line-through' : 'none', color: c.hecha ? 'text.secondary' : 'text.primary', fontSize: 14 } }}
              />
              {!soloLectura && (
                <IconButton size="small" onClick={() => poner('checklist', b.checklist.filter((_, j) => j !== i))} aria-label={`Quitar «${c.texto}»`}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              )}
            </Box>
          ))}
          {!soloLectura && (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Agregar un paso y Enter"
                value={nuevoPunto}
                onChange={(e) => setNuevoPunto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    agregarPunto()
                  }
                }}
              />
              <IconButton onClick={agregarPunto} aria-label="Agregar paso"><AddIcon /></IconButton>
            </Box>
          )}
        </Box>

        {(b.estado === 'hecha' || b.entregable) && (
          <Box>
            <TextField
              label="Entregable (opcional)"
              fullWidth
              size="small"
              value={b.entregable}
              onChange={(e) => poner('entregable', e.target.value)}
              disabled={soloLectura}
              helperText="Documento resultante (doc:12) o enlace."
            />
            {documentosVinculados.length > 0 && (
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.75 }}>
                {documentosVinculados.map((d) => (
                  <Chip key={d.id} size="small" variant={b.entregable === d.id ? 'filled' : 'outlined'} color={b.entregable === d.id ? 'primary' : 'default'} label={d.texto} onClick={() => poner('entregable', d.id)} />
                ))}
              </Box>
            )}
          </Box>
        )}

        {tarea && (
          <Box>
            <Divider sx={{ mb: 1.5 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Conversación y cambios</Typography>
            <Box sx={{ display: 'grid', gap: 0.75, mb: 1 }}>
              {(tarea.comentarios ?? []).map((c) => (
                <Box key={c.id} sx={{ fontSize: 13.5, color: c.sistema ? 'text.secondary' : 'text.primary', pl: c.sistema ? 0 : 1, borderLeft: c.sistema ? 'none' : '2px solid', borderColor: 'divider' }}>
                  <Typography component="span" sx={{ fontWeight: 600, fontSize: 12.5 }}>{c.usuario || 'Sistema'}</Typography>
                  <Typography component="span" variant="caption" color="text.secondary"> · {hace(c.creado_en)}</Typography>
                  <Typography sx={{ fontSize: 13.5, whiteSpace: 'pre-wrap', fontStyle: c.sistema ? 'italic' : 'normal' }}>{c.texto}</Typography>
                </Box>
              ))}
              {(tarea.comentarios ?? []).length === 0 && comentariosEnEspera.length === 0 && <Typography variant="body2" color="text.secondary">Aún sin comentarios.</Typography>}
              <EnEsperaLista lista={comentariosEnEspera} />
            </Box>
            {!soloLectura && (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
                <TextField size="small" fullWidth multiline maxRows={5} placeholder="Escribir al equipo (avance, duda, entrega)…" value={comentario} onChange={(e) => setComentario(e.target.value)} />
                <IconButton color="primary" onClick={() => void comentar()} disabled={!comentario.trim()} aria-label="Enviar comentario"><SendIcon /></IconButton>
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2 }}>
        {puedeEliminar && (
          <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={() => void eliminar()} sx={{ mr: 'auto' }}>Eliminar</Button>
        )}
        <Button onClick={cerrar}>{soloLectura ? 'Cerrar' : 'Cancelar'}</Button>
        {!soloLectura && <Button variant="contained" onClick={() => void guardar()} disabled={ocupado || !b.titulo.trim()}>{idActual ? 'Guardar' : parecida ? 'Crear igual' : 'Crear tarea'}</Button>}
      </DialogActions>
    </Dialog>
  )
}

export type { Borrador as BorradorTarea }
