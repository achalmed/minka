/**
 * TAREAS (módulo «Tareas y Agenda», 2026-10-06): el lugar donde los encargos dejan de
 * vivir en el chat. Una tarea tiene responsable único, plazo con hora, prioridad, estado
 * y vínculos con lo demás del sistema.
 *
 * Vistas por la dirección (navegacion.ts):
 *   /tareas              Mis tareas: alta rápida y tres pestañas, Pendientes (vencidas, hoy,
 *                        próximas, sin fecha), Prioritarias y Hechas (14 días); `?mis=…`
 *                        (2026-10-18, «hoy abruma»: filas compactas, sin chips de listas)
 *   /tareas?ver=hoy      Hoy: agenda del día y mis tareas de hoy y vencidas
 *   /tareas?ver=tablero  Tablero por estado (al modo de Trello), con Todas · Internas · Externas
 *                        (las solicitudes de reunión por confirmar, del lado externo)
 *   /tareas?ver=todas    Todas las del despacho, con filtros
 *   /tareas?ver=hechas   Las cerradas
 * Otras claves: `?abrir=<id>` abre una tarea (avisos de la campana), `?nueva=1` la elección
 * «formulario o prompt» del alta (con `&vinculo=doc:12&vinculo_texto=…` o `&entrada=<id>` de la
 * Bandeja de entrada; con `&prompt=1`, directo al pegado), `?pegar=<id de mensaje>` (del chat:
 * abre «Pegar tareas» con ese texto ya leído), `?lista=<id>`, `?entidad=doc:12` (las
 * vinculadas), `?plantilla=1`, `?importar=1`.
 * «Nueva tarea» es una entrada doble (fase 9.5): formulario o resultado del prompt `plan-de-tareas`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import Box from '@mui/material/Box'
import Container from '@mui/material/Container'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import InputAdornment from '@mui/material/InputAdornment'
import Chip from '@mui/material/Chip'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Alert from '@mui/material/Alert'
import LinearProgress from '@mui/material/LinearProgress'
import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import LibraryAddCheckOutlinedIcon from '@mui/icons-material/LibraryAddCheckOutlined'
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd'
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined'
import { api, Marco, PALETA, BarraModulo, EstadoVacio, ElegirEntrada, hay, pedirTexto } from '@qillqa/tiqsi'
import AltaRapida from '../componentes/tareas/AltaRapida'
import FilaTarea from '../componentes/tareas/FilaTarea'
import Tablero from '../componentes/tareas/Tablero'
import Matriz from '../componentes/tareas/Matriz'
import PanelHoy from '../componentes/tareas/PanelHoy'
import DialogoTarea from '../componentes/tareas/DialogoTarea'
import DialogoPlantilla from '../componentes/tareas/DialogoPlantilla'
import DialogoImportar from '../componentes/tareas/DialogoImportar'
import DialogoEvento from '../componentes/tareas/DialogoEvento'
import DialogoPegarTareas from '../componentes/tareas/DialogoPegarTareas'
import { textoDeMensaje } from '../componentes/tareas/apoyo'
import { avisarCambio, mensajeError, olvidarOpciones, recordarTareas, useAlCambiar, useOpcionesTareas, vinculoDeEntrada } from '../componentes/tareas/datos'
import { isoDia } from '../componentes/tareas/calendario'
import { contarClases, esPrioritaria, estaCerrada, filtrarClase, gruposPendientes, NOMBRE_CLASE, resumenMias, separarTramite, tituloCorto, type FiltroClase, type VistaMias } from '../componentes/tareas/organizar'
import type { BorradorTarea } from '../componentes/tareas/DialogoTarea'
import type { EventoAgenda, Tarea } from '../componentes/tareas/tipos'

type Vista = 'mias' | 'hoy' | 'tablero' | 'matriz' | 'todas' | 'hechas'
const TITULO: Record<Vista, string> = { mias: 'Mis tareas', hoy: 'Hoy', tablero: 'Tablero', matriz: 'Matriz de prioridades', todas: 'Todas las tareas', hechas: 'Hechas' }

/** Agrupa la lista como Todoist: vencidas, hoy, próximos 7 días, más adelante, sin fecha. */
function grupos(tareas: Tarea[]): { titulo: string; tareas: Tarea[] }[] {
  const hoy = isoDia(new Date())
  const semana = isoDia(new Date(Date.now() + 7 * 86_400_000))
  const g: Record<string, Tarea[]> = { Vencidas: [], Hoy: [], 'Próximos 7 días': [], 'Más adelante': [], 'Sin fecha': [], Cerradas: [] }
  for (const t of tareas) {
    if (t.estado === 'hecha' || t.estado === 'cancelada') g.Cerradas.push(t)
    else if (t.vencida) g.Vencidas.push(t)
    else if (!t.vence_fecha) g['Sin fecha'].push(t)
    else if (t.vence_fecha === hoy) g.Hoy.push(t)
    else if (t.vence_fecha <= semana) g['Próximos 7 días'].push(t)
    else g['Más adelante'].push(t)
  }
  return Object.entries(g).filter(([, v]) => v.length).map(([titulo, v]) => ({ titulo, tareas: v }))
}

const MIS: Record<VistaMias, string> = { pendientes: 'Pendientes', prioritarias: 'Prioritarias', hechas: 'Hechas' }
const CLAVE_CLASE = 'qillqa_tablero_clase'
const claseGuardada = (): FiltroClase => {
  try {
    const v = localStorage.getItem(CLAVE_CLASE)
    return v === 'interna' || v === 'externa' ? v : 'todas'
  } catch {
    return 'todas'
  }
}

/** Un grupo de filas con su título y su cuenta. 2026-10-19 (Edison: «limpio, moderno, minimalista»):
 *  sin caja; el título como rótulo y las filas separadas solo por aire. */
function GrupoFilas({ titulo, n, alerta, children }: { titulo?: string; n?: number; alerta?: boolean; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      {titulo && (
        <Typography sx={{ mb: 0.25, px: 1, fontSize: 13, fontWeight: 700, letterSpacing: 0.2, color: alerta ? 'error.main' : 'text.primary' }}>
          {titulo} <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 500, color: 'text.disabled', ml: 0.25 }}>{n}</Typography>
        </Typography>
      )}
      <Box sx={{ '& > div:last-of-type': { borderBottom: 'none' } }}>{children}</Box>
    </Box>
  )
}

export default function Tareas() {
  const [consulta, setConsulta] = useSearchParams()
  const op = useOpcionesTareas()
  const ver = (consulta.get('ver') as Vista) || 'mias'
  const vista: Vista = TITULO[ver] ? ver : 'mias'
  const listaId = consulta.get('lista') ? Number(consulta.get('lista')) : null
  const entidad = consulta.get('entidad') ?? ''
  const [q, setQ] = useState('')
  const [responsable, setResponsable] = useState<number | ''>('')
  const [tareas, setTareas] = useState<Tarea[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [abierta, setAbierta] = useState<number | null>(null)
  const [nueva, setNueva] = useState<Partial<BorradorTarea> | null>(null)
  const [evento, setEvento] = useState<{ id: number; ocurrencia?: string | null } | null>(null)
  const [plantilla, setPlantilla] = useState(false)
  const [importar, setImportar] = useState(false)
  // Entrada doble del alta: la elección anclada al botón y el pegado del prompt.
  const refNueva = useRef<HTMLButtonElement | null>(null)
  const [anclaNueva, setAnclaNueva] = useState<HTMLElement | null>(null)
  const [inicialNueva, setInicialNueva] = useState<Partial<BorradorTarea>>({})
  const [pegar, setPegar] = useState<{ texto: string; vinculo: string } | null>(null)
  // Sin «formulario o prompt» en el anfitrión (sola), la elección es el formulario.
  useEffect(() => {
    if (anclaNueva && !hay('ElegirEntrada')) {
      setNueva(inicialNueva)
      setAnclaNueva(null)
    }
  }, [anclaNueva, inicialNueva])
  const soloLectura = op ? !op.puede_escribir : false
  const mis: VistaMias = (consulta.get('mis') as VistaMias) in MIS ? (consulta.get('mis') as VistaMias) : 'pendientes'
  const [clase, setClaseEstado] = useState<FiltroClase>(claseGuardada)
  const setClase = (c: FiltroClase) => {
    setClaseEstado(c)
    try { localStorage.setItem(CLAVE_CLASE, c) } catch { /* sin almacenamiento: solo esta vez */ }
  }
  const [solicitudes, setSolicitudes] = useState<EventoAgenda[] | null>(null)

  const leer = useCallback(async () => {
    if (vista === 'hoy') return setCargando(false)
    const p = new URLSearchParams()
    p.set('vista', vista === 'tablero' || vista === 'matriz' ? 'todas' : vista)
    if (vista === 'tablero') p.set('incluir_cerradas', 'true')
    if (vista === 'mias') p.set('cerradas_dias', '14')
    if (q.trim()) p.set('q', q.trim())
    if (listaId) p.set('lista_id', String(listaId))
    if (entidad) p.set('entidad', entidad)
    if (responsable !== '' && vista !== 'mias') p.set('responsable_id', String(responsable))
    try {
      const [r, sol] = await Promise.all([
        api<{ tareas: Tarea[] }>(`/api/tareas?${p}`),
        // Las solicitudes de reunión van del lado externo del tablero (2026-10-18).
        vista === 'tablero' ? api<{ eventos: EventoAgenda[] }>('/api/agenda/por-confirmar').then((x) => x.eventos).catch(() => null) : Promise.resolve(null),
      ])
      recordarTareas(r.tareas)
      setTareas(r.tareas)
      setSolicitudes(sol)
      setError('')
    } catch (e) {
      setError(mensajeError(e))
    } finally {
      setCargando(false)
    }
  }, [vista, q, listaId, entidad, responsable])

  useEffect(() => {
    setCargando(true)
    const t = window.setTimeout(() => void leer(), q ? 250 : 0)
    return () => window.clearTimeout(t)
  }, [leer, q])
  useAlCambiar(useCallback(() => void leer(), [leer]))

  // Lo que pide la dirección: abrir una tarea, el alta (con su vínculo), plantilla, importar.
  useEffect(() => {
    const abrir = Number(consulta.get('abrir') ?? '')
    if (abrir) setAbierta(abrir)
    if (consulta.get('nueva') === '1') {
      const entrada = Number(consulta.get('entrada') ?? '')
      const vinculo = consulta.get('vinculo')
      // `&prompt=1`: directo al pegado; si no, la elección anclada al botón (sin botón, el formulario).
      const abrirAlta = (inicial: Partial<BorradorTarea>) => {
        if (consulta.get('prompt') === '1') return setPegar({ texto: '', vinculo: inicial.vinculos?.[0]?.id ?? '' })
        setInicialNueva(inicial)
        if (refNueva.current) setAnclaNueva(refNueva.current)
        else setNueva(inicial)
      }
      if (entrada) {
        void vinculoDeEntrada(entrada).then(({ vinculo: v, asunto }) => abrirAlta({ vinculos: [v], titulo: asunto ? `Atender: ${asunto}`.slice(0, 300) : '' }))
      } else {
        abrirAlta(vinculo ? { vinculos: [{ id: vinculo, texto: consulta.get('vinculo_texto') || vinculo }] } : {})
      }
    }
    const mid = Number(consulta.get('pegar') ?? '')
    if (mid) {
      textoDeMensaje(mid)
        .then((t) => setPegar({ texto: t, vinculo: '' }))
        .catch(() => { setError('No se pudo traer el mensaje del chat; pegue el texto a mano.'); setPegar({ texto: '', vinculo: '' }) })
    }
    if (consulta.get('plantilla') === '1') setPlantilla(true)
    if (consulta.get('importar') === '1') setImportar(true)
    if (abrir || consulta.get('nueva') || consulta.get('pegar') || consulta.get('plantilla') || consulta.get('importar')) {
      const limpia = new URLSearchParams(consulta)
      ;['abrir', 'nueva', 'entrada', 'vinculo', 'vinculo_texto', 'prompt', 'pegar', 'plantilla', 'importar'].forEach((k) => limpia.delete(k))
      setConsulta(limpia, { replace: true })
    }
  }, [consulta, setConsulta])

  const cambiarLocal = (id: number, cambio: Partial<Tarea>) => setTareas((ts) => ts.map((t) => (t.id === id ? { ...t, ...cambio } : t)))
  const lista = op?.listas.find((l) => l.id === listaId)
  const nuevaLista = async () => {
    const nombre = (await pedirTexto('Nombre de la lista (p. ej. «Comisión de Educación», «Campaña de cartas»):', { inicial: '', etiqueta: 'Nombre', aceptar: 'Crear' }))?.trim()
    if (!nombre) return
    try {
      const l = await api<{ id: number }>('/api/tareas/listas', { method: 'POST', body: JSON.stringify({ nombre }) })
      olvidarOpciones()
      avisarCambio()
      const p = new URLSearchParams(consulta)
      p.set('lista', String(l.id))
      setConsulta(p)
    } catch (e) {
      setError(mensajeError(e))
    }
  }
  const quitarFiltro = (k: string) => {
    const p = new URLSearchParams(consulta)
    p.delete(k)
    setConsulta(p)
  }
  const agrupadas = useMemo(() => grupos(tareas), [tareas])
  const hoy = isoDia(new Date())
  const cuentaMias = useMemo(() => resumenMias(tareas), [tareas])
  const cuentaClases = useMemo(() => contarClases(tareas.filter((t) => t.estado !== 'cancelada')), [tareas])
  const irMis = (m: VistaMias) => {
    const p = new URLSearchParams(consulta)
    if (m === 'pendientes') p.delete('mis')
    else p.set('mis', m)
    setConsulta(p, { replace: true })
  }
  const vinculoEntidad = entidad ? [{ id: entidad, texto: entidad }] : []

  return (
    <Marco
      modulo="tareas"
      titulo={TITULO[vista]}
      fondo={PALETA.fondo}
    >
      <Container maxWidth={vista === 'tablero' || vista === 'matriz' ? 'xl' : 'lg'} sx={{ py: { xs: 2, sm: 3 }, px: { xs: 1.5, sm: 3 } }}>
        {/* 2026-10-06: el título grande solo con una lista elegida; el de la vista ya está en la barra. */}
        {lista && (
          <Typography component="h2" sx={{ fontSize: { xs: 19, sm: 21 }, fontWeight: 650, mb: 1 }}>
            {lista.nombre}
          </Typography>
        )}
        <BarraModulo
          alActualizar={leer}
          principal={!soloLectura && vista !== 'hoy' && (
            <Button ref={refNueva} variant="contained" startIcon={<AddIcon />} onClick={(e) => { setInicialNueva(entidad ? { vinculos: vinculoEntidad } : lista ? { lista_id: lista.id } : {}); setAnclaNueva(e.currentTarget) }}>Nueva tarea</Button>
          )}
          mas={soloLectura ? [] : [
            { etiqueta: 'Desde una plantilla', icono: <LibraryAddCheckOutlinedIcon fontSize="small" />, alPulsar: () => setPlantilla(true) },
            { etiqueta: 'Nueva lista', icono: <PlaylistAddIcon fontSize="small" />, alPulsar: () => void nuevaLista() },
            { etiqueta: 'Importar de Super Productivity', icono: <UploadFileOutlinedIcon fontSize="small" />, alPulsar: () => setImportar(true) },
          ]}
        >
          {vista !== 'hoy' && (
            <TextField
              size="small"
              placeholder="Buscar"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>, sx: { bgcolor: 'background.paper' } }}
              // En «Mis tareas» del celular, un solo campo arriba (la alta rápida); buscar queda en «Todas».
              sx={{ width: { xs: '100%', sm: 220 }, display: { xs: vista === 'mias' ? 'none' : 'inline-flex', sm: 'inline-flex' } }}
            />
          )}
          {(vista === 'todas' || vista === 'tablero' || vista === 'matriz' || vista === 'hechas') && (
            <TextField select size="small" value={responsable} onChange={(e) => setResponsable(e.target.value === '' ? '' : Number(e.target.value))} sx={{ minWidth: 170, bgcolor: 'background.paper' }} SelectProps={{ displayEmpty: true }} inputProps={{ 'aria-label': 'Responsable' }}>
              <MenuItem value="">Todo el equipo</MenuItem>
              <MenuItem value={0}>Sin responsable</MenuItem>
              {op?.usuarios.map((u) => <MenuItem key={u.id} value={u.id}>{u.nombre}</MenuItem>)}
            </TextField>
          )}
        </BarraModulo>

        {(op?.listas.filter((l) => !l.archivada).length ?? 0) > 0 && vista !== 'hoy' && vista !== 'mias' && (
          <Box sx={{ display: 'flex', gap: 0.75, overflowX: 'auto', pb: 1, mb: 1 }}>
            {op?.listas.filter((l) => !l.archivada).map((l) => (
              <Chip
                key={l.id}
                size="small"
                label={l.nombre}
                variant={listaId === l.id ? 'filled' : 'outlined'}
                color={listaId === l.id ? 'primary' : 'default'}
                onClick={() => { const p = new URLSearchParams(consulta); if (listaId === l.id) p.delete('lista'); else p.set('lista', String(l.id)); setConsulta(p) }}
                sx={{ flexShrink: 0 }}
              />
            ))}
          </Box>
        )}
        {entidad && <Chip label={`Vinculadas a ${entidad}`} onDelete={() => quitarFiltro('entidad')} sx={{ mb: 1.5 }} />}

        {vista === 'hoy' ? (
          <>
            {!soloLectura && <Box sx={{ mb: 2 }}><AltaRapida /></Box>}
            <PanelHoy alAbrirTarea={(t) => setAbierta(t.id)} alAbrirEvento={(e: EventoAgenda) => setEvento({ id: e.id, ocurrencia: e.ocurrencia })} />
          </>
        ) : (
          <>
            {!soloLectura && vista !== 'hechas' && (
              <Box sx={{ mb: 2 }}>
                <AltaRapida listaId={listaId} vinculos={entidad ? [entidad] : []} />
              </Box>
            )}
            {cargando && <LinearProgress sx={{ mb: 1 }} />}
            {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
            {vista === 'tablero' && (
              <ToggleButtonGroup size="small" exclusive value={clase} onChange={(_, v) => v && setClase(v)} aria-label="Clase de tareas" sx={{ mb: 1.5, bgcolor: 'background.paper' }}>
                {(['todas', 'interna', 'externa'] as FiltroClase[]).map((c) => (
                  <ToggleButton key={c} value={c} sx={{ textTransform: 'none', px: 1.5, gap: 0.75 }}>
                    {NOMBRE_CLASE[c]}
                    <Typography component="span" variant="caption" color="text.secondary">{cuentaClases[c] + (c !== 'interna' ? solicitudes?.length ?? 0 : 0)}</Typography>
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            )}
            {vista === 'mias' && (
              // Pestañas de texto, sin marco (2026-10-19): la elegida lleva la raya; las demás, tenues.
              <Tabs value={mis} onChange={(_, v) => irMis(v)} aria-label="Mis tareas" variant="fullWidth" sx={{ mb: 1.5, minHeight: 40, maxWidth: { sm: 460 }, '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontSize: 14, fontWeight: 600, px: 1 } }}>
                {(Object.keys(MIS) as VistaMias[]).map((m) => (
                  <Tab key={m} value={m} label={<Box component="span">{MIS[m]} <Box component="span" sx={{ fontWeight: 500, color: m === 'prioritarias' && cuentaMias[m] ? 'primary.main' : 'text.disabled', ml: 0.25 }}>{cuentaMias[m]}</Box></Box>} />
                ))}
              </Tabs>
            )}
            {vista === 'matriz' ? (
              <Matriz tareas={tareas} alAbrir={(t) => setAbierta(t.id)} soloLectura={soloLectura} alCambiarLocal={cambiarLocal} />
            ) : vista === 'tablero' ? (
              <Tablero
                tareas={filtrarClase(tareas.filter((t) => t.estado !== 'cancelada'), clase)}
                alAbrir={(t) => setAbierta(t.id)}
                soloLectura={soloLectura}
                alCambiarLocal={cambiarLocal}
                solicitudes={clase === 'interna' ? null : solicitudes}
                alAbrirEvento={(e) => setEvento({ id: e.id })}
                marcarExternas={clase === 'todas'}
              />
            ) : vista === 'mias' ? (
              <MisTareas tareas={tareas} mis={mis} hoy={hoy} cargando={cargando} soloLectura={soloLectura} alAbrir={(id) => setAbierta(id)} />
            ) : !cargando && tareas.length === 0 ? (
              // 2026-10-06: sin la sintaxis de alta: la repite la ayuda de AltaRapida.
              <EstadoVacio
                icono={<ChecklistOutlinedIcon />}
                titulo={vista === 'hechas' ? 'Aún no hay tareas cerradas' : 'Nada pendiente'}
              />
            ) : (
              // `minmax(0,1fr)` + minWidth 0: un vínculo largo (nowrap) no ensancha el grupo más allá del celular.
              <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2 }}>
                {(vista === 'hechas' ? [{ titulo: 'Cerradas', tareas }] : agrupadas).map((g) => (
                  <Box key={g.titulo} sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5, color: g.titulo === 'Vencidas' ? 'error.main' : 'text.primary' }}>
                      {g.titulo} <Typography component="span" variant="caption" color="text.secondary">{g.tareas.length}</Typography>
                    </Typography>
                    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2.5, bgcolor: 'background.paper', overflow: 'hidden', '& > div:last-of-type': { borderBottom: 'none' } }}>
                      {g.tareas.map((t) => <FilaTarea key={t.id} t={t} alAbrir={() => setAbierta(t.id)} soloLectura={soloLectura} />)}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </>
        )}
      </Container>

      <DialogoTarea abierto={abierta !== null} tareaId={abierta} alCerrar={() => setAbierta(null)} />
      <DialogoTarea abierto={nueva !== null} inicial={nueva ?? undefined} alCerrar={() => setNueva(null)} />
      <ElegirEntrada
        ancla={anclaNueva}
        alCerrar={() => setAnclaNueva(null)}
        tipo="plan-de-tareas"
        alManual={() => setNueva(inicialNueva)}
        alPrompt={() => setPegar({ texto: '', vinculo: inicialNueva.vinculos?.[0]?.id ?? '' })}
      />
      <DialogoPegarTareas
        abierto={pegar !== null}
        textoInicial={pegar?.texto || undefined}
        vinculo={pegar?.vinculo || undefined}
        alCerrar={() => setPegar(null)}
        alRegistrado={() => void leer()}
      />
      <DialogoPlantilla abierto={plantilla} alCerrar={() => setPlantilla(false)} vinculosIniciales={vinculoEntidad} />
      <DialogoImportar abierto={importar} que="superproductivity" alCerrar={() => setImportar(false)} />
      <DialogoEvento abierto={evento !== null} eventoId={evento?.id} ocurrencia={evento?.ocurrencia} alCerrar={() => setEvento(null)} />
    </Marco>
  )
}

const MUESTRA_TRAMITE = 5

/** Un paso del trámite con sus oficios (2026-10-19): cortos, los primeros cinco y «Ver las N». */
function GrupoTramite({ paso, tareas, soloLectura, alAbrir }: { paso: string; tareas: Tarea[]; soloLectura: boolean; alAbrir: (id: number) => void }) {
  const [todas, setTodas] = useState(false)
  const lista = todas ? tareas : tareas.slice(0, MUESTRA_TRAMITE)
  return (
    <GrupoFilas titulo={paso} n={tareas.length}>
      {lista.map((t) => {
        const c = tituloCorto(t.titulo)
        return (
          <FilaTarea
            key={t.id}
            t={t}
            alAbrir={() => alAbrir(t.id)}
            soloLectura={soloLectura}
            conResponsable={false}
            compacta
            titulo={<><Box component="span" sx={{ fontWeight: 600 }}>{c.documento}</Box>{c.asunto ? <Box component="span" sx={{ color: 'text.secondary' }}> · {c.asunto}</Box> : null}</>}
          />
        )
      })}
      {tareas.length > MUESTRA_TRAMITE && (
        <Box sx={{ px: 1, py: 0.25 }}>
          <Button size="small" onClick={() => setTodas((v) => !v)} sx={{ textTransform: 'none', px: 0.5, color: 'text.secondary', fontWeight: 500 }}>{todas ? 'Ver menos' : `Ver las ${tareas.length}`}</Button>
        </Box>
      )}
    </GrupoFilas>
  )
}

/** «Mis tareas» (2026-10-18): lo pendiente por cuándo vence, lo prioritario y lo hecho, en filas compactas.
 *  2026-10-19 (Edison: «sigue muy saturado»): lo que crea el trámite de los oficios va aparte, al
 *  final, agrupado por paso y con el título corto; arriba quedan solo las tareas propias. */
function MisTareas({ tareas, mis, hoy, cargando, soloLectura, alAbrir }: {
  tareas: Tarea[]; mis: VistaMias; hoy: string; cargando: boolean; soloLectura: boolean; alAbrir: (id: number) => void
}) {
  const fila = (t: Tarea) => <FilaTarea key={t.id} t={t} alAbrir={() => alAbrir(t.id)} soloLectura={soloLectura} conResponsable={false} compacta />
  if (mis === 'pendientes') {
    const { propias, tramite } = separarTramite(tareas.filter((t) => !estaCerrada(t)))
    const grupos = gruposPendientes(propias, hoy)
    if (!cargando && grupos.length === 0 && tramite.length === 0) return <EstadoVacio icono={<ChecklistOutlinedIcon />} titulo="Nada pendiente" />
    return (
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2 }}>
        {grupos.map((g) => <GrupoFilas key={g.clave} titulo={g.titulo} n={g.tareas.length} alerta={g.clave === 'vencidas'}>{g.tareas.map(fila)}</GrupoFilas>)}
        {tramite.length > 0 && (
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ display: 'block', px: 1, color: 'text.disabled', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, mb: 0.75 }}>Trámite de los oficios</Typography>
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              {tramite.map((g) => <GrupoTramite key={g.paso} paso={g.paso} tareas={g.tareas} soloLectura={soloLectura} alAbrir={alAbrir} />)}
            </Box>
          </Box>
        )}
      </Box>
    )
  }
  const lista = mis === 'prioritarias'
    ? tareas.filter((t) => !estaCerrada(t) && esPrioritaria(t))
    : tareas.filter((t) => t.estado === 'hecha').sort((a, b) => (b.cerrada_en ?? '').localeCompare(a.cerrada_en ?? ''))
  if (!cargando && lista.length === 0) {
    return <EstadoVacio icono={<ChecklistOutlinedIcon />} titulo={mis === 'prioritarias' ? 'Nada urgente ni importante' : 'Nada cerrado en las últimas dos semanas'} />
  }
  return <GrupoFilas>{lista.map(fila)}</GrupoFilas>
}
