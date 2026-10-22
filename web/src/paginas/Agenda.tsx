/**
 * AGENDA (módulo «Tareas y Agenda», 2026-10-06): calendario del despacho en mes, semana y
 * día, al modo de Google Calendar, con las tareas con plazo en su día y los choques de
 * horario a la vista. Se suscribe desde otro calendario (ICS) y se importa un .ics.
 *
 * Solo lo CONFIRMADO va al calendario (2026-10-18): lo solicitado espera en «Por confirmar»
 * (componentes/tareas/PorConfirmar.tsx), al lado del calendario desde 1200 px y, más angosto,
 * como vista propia (`?vista=por_confirmar`) a la que lleva una franja con el contador.
 *
 * Dirección: `?vista=mes|semana|dia|por_confirmar`, `?fecha=AAAA-MM-DD`, `?abrir=<id>&ocurrencia=…`,
 * `?nuevo=1` (con `&entrada=<id>` de la Bandeja de entrada, o `&vinculo=doc:12&vinculo_texto=…`;
 * con `&prompt=1`, directo a «Pegar actividades»), `?pegar=<id de mensaje>` (del chat: abre
 * «Pegar actividades» con ese texto ya leído).
 * «Agendar» es una entrada doble (fase 9.5): formulario o resultado del prompt; el «Nuevo evento»
 * que abre un clic en el calendario ofrece también pegar el resultado del prompt.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import Box from '@mui/material/Box'
import Container from '@mui/material/Container'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Alert from '@mui/material/Alert'
import LinearProgress from '@mui/material/LinearProgress'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ButtonBase from '@mui/material/ButtonBase'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import AddIcon from '@mui/icons-material/Add'
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined'
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined'
import { api, Marco, BarraModulo, PALETA, ElegirEntrada, hay } from '@qillqa/tiqsi'
import Calendario, { type VistaCalendario } from '../componentes/tareas/Calendario'
import DialogoEvento from '../componentes/tareas/DialogoEvento'
import TarjetaEvento, { claveDe } from '../componentes/tareas/TarjetaEvento'
import DialogoTarea from '../componentes/tareas/DialogoTarea'
import DialogoImportar from '../componentes/tareas/DialogoImportar'
import DialogoSuscripcion from '../componentes/tareas/DialogoSuscripcion'
import DialogoPegarAgenda from '../componentes/tareas/DialogoPegarAgenda'
import PorConfirmar from '../componentes/tareas/PorConfirmar'
import { textoCruces } from '../componentes/tareas/organizar'
import { LineaAtencion } from '../componentes/tareas/MarcaCruce'
import { textoDeMensaje, distritos as traerDistritos, type Distrito } from '../componentes/tareas/apoyo'
import { mensajeError, recordarTareas, useAlCambiar, useOpcionesAgenda, vinculoDeEntrada } from '../componentes/tareas/datos'
import { cuadriculaMes, desdeIso, diasDeLaSemana, diasEntre, isoDia, sumarDias, tituloDia, tituloMes, tituloSemana, tituloTresDias, tresDias } from '../componentes/tareas/calendario'
import { COLOR_TIPO, FONDO_TIPO, NOMBRE_TIPO, type Choque, type EventoAgenda, type Feriado, type Tarea, type Vinculo } from '../componentes/tareas/tipos'

const VISTAS: VistaCalendario[] = ['mes', 'semana', 'tres', 'dia']

export default function Agenda() {
  const [consulta, setConsulta] = useSearchParams()
  const op = useOpcionesAgenda()
  const ancho = useMediaQuery(useTheme().breakpoints.up('lg'))
  // Más angosto que 1200 px la lista es una vista propia; en escritorio va al lado del calendario.
  const enLista = consulta.get('vista') === 'por_confirmar' && !ancho
  const [porConfirmar, setPorConfirmar] = useState(0)
  const vista: VistaCalendario = VISTAS.includes(consulta.get('vista') as VistaCalendario) ? (consulta.get('vista') as VistaCalendario) : 'tres'
  const fecha = useMemo(() => (/^\d{4}-\d{2}-\d{2}$/.test(consulta.get('fecha') ?? '') ? desdeIso(consulta.get('fecha')!) : desdeIso(isoDia(new Date()))), [consulta])
  const [eventos, setEventos] = useState<EventoAgenda[]>([])
  const [choques, setChoques] = useState<Choque[]>([])
  const [tareas, setTareas] = useState<Tarea[]>([])
  const [feriados, setFeriados] = useState<Record<string, Feriado[]>>({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState<{ id: number; ocurrencia?: string | null } | null>(null)
  // La tarjeta rápida (2026-10-19): tocar un evento la abre; el formulario, desde ella.
  const [tarjeta, setTarjeta] = useState<string | null>(null)
  const [pegar, setPegar] = useState(false)
  const [textoPegar, setTextoPegar] = useState('')
  const [vinculosPegar, setVinculosPegar] = useState<string[]>([])
  const [anclaNuevo, setAnclaNuevo] = useState<HTMLElement | null>(null)
  const [nuevo, setNuevo] = useState<{ fecha?: string; hora?: string; vinculos?: Vinculo[]; titulo?: string } | null>(null)
  // Sin «formulario o prompt» en el anfitrión (sola), la elección es el formulario.
  const agendar = (ancla: HTMLElement) =>
    hay('ElegirEntrada') ? setAnclaNuevo(ancla) : setNuevo({ fecha: vista === 'dia' ? isoDia(fecha) : isoDia(new Date()) })
  const [tarea, setTarea] = useState<number | null>(null)
  const [importar, setImportar] = useState(false)
  const [suscribir, setSuscribir] = useState(false)
  const soloLectura = op ? !op.puede_escribir : false

  const [desde, hasta] = useMemo(() => {
    if (vista === 'mes') {
      const c = cuadriculaMes(fecha)
      return [isoDia(c[0]), isoDia(c[41])]
    }
    if (vista === 'semana') {
      const d = diasDeLaSemana(fecha)
      return [isoDia(d[0]), isoDia(d[6])]
    }
    if (vista === 'tres') {
      const d = tresDias(fecha)
      return [isoDia(d[0]), isoDia(d[2])]
    }
    return [isoDia(fecha), isoDia(fecha)]
  }, [vista, fecha])

  // Los distritos se piden una vez (para los aniversarios de cada vista).
  const distritos = useRef<Distrito[] | null>(null)
  const leer = useCallback(async () => {
    setCargando(true)
    try {
      const [ev, ts, fs, ds] = await Promise.all([
        api<{ eventos: EventoAgenda[]; choques: Choque[]; por_confirmar?: number }>(`/api/agenda/eventos?desde=${desde}&hasta=${hasta}`),
        api<{ tareas: Tarea[] }>('/api/tareas?vista=mias'),
        api<Feriado[]>(`/api/agenda/feriados?desde=${desde}&hasta=${hasta}`).catch(() => [] as Feriado[]),
        distritos.current ?? traerDistritos(),
      ])
      recordarTareas(ts.tareas)
      if (!distritos.current && ds.length) distritos.current = ds
      const porDia: Record<string, Feriado[]> = {}
      fs.forEach((f) => (porDia[f.fecha] ??= []).push(f))
      // Aniversarios de creación de los distritos (2026-10-08): discretos, como las fechas
      // cívicas, bajo el número del día.
      for (const iso of diasEntre(desde, hasta)) {
        const [, m, d] = iso.split('-').map(Number)
        ds.filter((x) => x.mes === m && x.dia === d).forEach((x) =>
          (porDia[iso] ??= []).push({ fecha: iso, nombre: `Aniv. ${x.distrito}`, tipo: 'civica' }))
      }
      setFeriados(porDia)
      setEventos(ev.eventos)
      setChoques(ev.choques)
      setPorConfirmar(ev.por_confirmar ?? 0)
      setTareas(ts.tareas.filter((t) => t.vence_fecha && t.vence_fecha >= desde && t.vence_fecha <= hasta))
      setError('')
    } catch (e) {
      setError(mensajeError(e))
    } finally {
      setCargando(false)
    }
  }, [desde, hasta])
  useEffect(() => void leer(), [leer])
  useAlCambiar(useCallback(() => void leer(), [leer]))

  useEffect(() => {
    const abrir = Number(consulta.get('abrir') ?? '')
    if (abrir) setAbierto({ id: abrir, ocurrencia: consulta.get('ocurrencia') })
    if (consulta.get('nuevo') === '1' && consulta.get('prompt') === '1') {
      // Directo al pegado, con el vínculo que traiga (recibido o documento).
      const entrada = Number(consulta.get('entrada') ?? '')
      const vinculo = consulta.get('vinculo')
      setVinculosPegar(entrada ? [`entrada:${entrada}`] : vinculo ? [vinculo] : [])
      setTextoPegar('')
      setPegar(true)
    } else if (consulta.get('nuevo') === '1') {
      const entrada = Number(consulta.get('entrada') ?? '')
      const vinculo = consulta.get('vinculo')
      if (entrada) void vinculoDeEntrada(entrada).then(({ vinculo: v, asunto }) => setNuevo({ vinculos: [v], titulo: asunto.slice(0, 300) }))
      else setNuevo(vinculo ? { vinculos: [{ id: vinculo, texto: consulta.get('vinculo_texto') || vinculo }] } : {})
    }
    const mid = Number(consulta.get('pegar') ?? '')
    if (mid) {
      textoDeMensaje(mid)
        .then((t) => { setTextoPegar(t); setPegar(true) })
        .catch(() => { setError('No se pudo traer el mensaje del chat; pegue el texto a mano.'); setPegar(true) })
    }
    if (abrir || consulta.get('nuevo') || consulta.get('pegar')) {
      const p = new URLSearchParams(consulta)
      ;['abrir', 'ocurrencia', 'nuevo', 'entrada', 'vinculo', 'vinculo_texto', 'pegar', 'prompt'].forEach((k) => p.delete(k))
      setConsulta(p, { replace: true })
    }
  }, [consulta, setConsulta])

  const ir = (cambios: Record<string, string>) => {
    const p = new URLSearchParams(consulta)
    Object.entries(cambios).forEach(([k, v]) => p.set(k, v))
    setConsulta(p)
  }
  const mover = (n: number) => {
    const d = vista === 'mes' ? new Date(fecha.getFullYear(), fecha.getMonth() + n, 1) : sumarDias(fecha, vista === 'semana' ? 7 * n : vista === 'tres' ? 3 * n : n)
    ir({ fecha: isoDia(d) })
  }
  const titulo = vista === 'mes' ? tituloMes(fecha) : vista === 'semana' ? tituloSemana(fecha) : vista === 'tres' ? tituloTresDias(fecha) : tituloDia(fecha)
  const graves = choques.filter((c) => c.gravedad === 'alta')

  return (
    <Marco
      modulo="tareas"
      titulo="Agenda"
      fondo={PALETA.fondo}
    >
      <Container maxWidth="xl" sx={{ py: { xs: 1.5, sm: 2.5 }, px: { xs: 1.5, sm: 3 } }}>
        <BarraModulo
          alActualizar={leer}
          mb={1}
          principal={!soloLectura && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={(e) => agendar(e.currentTarget)}>Agendar</Button>
          )}
          mas={[
            { etiqueta: 'Ver en otro calendario (ICS)', icono: <CalendarMonthOutlinedIcon fontSize="small" />, alPulsar: () => setSuscribir(true) },
            !soloLectura && { etiqueta: 'Importar un .ics', icono: <UploadFileOutlinedIcon fontSize="small" />, alPulsar: () => setImportar(true) },
          ]}
        />
        {!ancho && (porConfirmar > 0 || enLista) && (
          <ButtonBase
            onClick={() => ir({ vista: enLista ? 'tres' : 'por_confirmar' })}
            // Una línea, sin caja (2026-10-19): el punto dorado dice «por confirmar».
            sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', alignItems: 'center', gap: 1, px: 0.5, py: 0.5, mb: 1, borderRadius: 1.5, color: enLista ? 'text.secondary' : 'text.primary' }}
          >
            {enLista ? <ChevronLeftIcon sx={{ fontSize: 20, color: 'text.secondary' }} /> : <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: PALETA.dorado, mx: 0.5 }} />}
            <Typography sx={{ fontSize: 14, fontWeight: 600, flex: 1, textAlign: 'left' }}>
              {enLista ? 'Volver al calendario' : `${porConfirmar} por confirmar`}
            </Typography>
            {!enLista && <ChevronRightIcon sx={{ fontSize: 20, color: 'text.secondary' }} />}
          </ButtonBase>
        )}
        {enLista ? (
          // Abajo, el espacio del botón flotante del celular: no tapa la última tarjeta.
          <Box sx={{ pb: 9 }}>
            <PorConfirmar alAbrir={(e) => setAbierto({ id: e.id })} soloLectura={soloLectura} alContar={setPorConfirmar} />
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: ancho && porConfirmar > 0 ? 'minmax(0, 1fr) 320px' : 'minmax(0, 1fr)', alignItems: 'start' }}>
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <IconButton onClick={() => mover(-1)} aria-label="Anterior"><ChevronLeftIcon /></IconButton>
                  <Button size="small" variant="outlined" onClick={() => ir({ fecha: isoDia(new Date()) })} sx={{ mx: 0.5 }}>Hoy</Button>
                  <IconButton onClick={() => mover(1)} aria-label="Siguiente"><ChevronRightIcon /></IconButton>
                </Box>
                <Typography component="h2" sx={{ fontSize: { xs: 16.5, sm: 20 }, fontWeight: 650, flex: 1, minWidth: 150, '&::first-letter': { textTransform: 'uppercase' } }}>{titulo}</Typography>
                <ToggleButtonGroup size="small" exclusive value={vista} onChange={(_, v) => v && ir({ vista: v })} aria-label="Vista del calendario">
                  <ToggleButton value="mes" sx={{ textTransform: 'none', px: 1.5 }}>Mes</ToggleButton>
                  <ToggleButton value="semana" sx={{ textTransform: 'none', px: 1.5 }}>Semana</ToggleButton>
                  <ToggleButton value="tres" sx={{ textTransform: 'none', px: 1.5 }}>3 días</ToggleButton>
                  <ToggleButton value="dia" sx={{ textTransform: 'none', px: 1.5 }}>Día</ToggleButton>
                </ToggleButtonGroup>
              </Box>
              {cargando && <LinearProgress sx={{ mb: 1 }} />}
              {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
              {/* 2026-10-19 (Edison: «muy grande o abrumador»): una línea tenue que lleva al día del
                  primer cruce; el detalle está en cada evento marcado. */}
              {graves.length > 0 && (
                <LineaAtencion
                  texto={`${textoCruces(graves.length)} · ${new Date(graves[0].desde).toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric' })} · decida quién va`}
                  alPulsar={() => ir({ vista: 'dia', fecha: graves[0].desde.slice(0, 10) })}
                  sx={{ mb: 1, px: 0.5, py: 0.25, borderRadius: 1, width: 'auto' }}
                />
              )}
              <Calendario
                vista={vista}
                fecha={fecha}
                eventos={eventos}
                tareas={tareas}
                feriados={feriados}
                alAbrirEvento={(e) => setTarjeta(claveDe(e))}
                alAbrirTarea={(t) => setTarea(t.id)}
                alNuevo={(f, h) => !soloLectura && setNuevo({ fecha: f, hora: h })}
                alIrADia={(f) => ir({ vista: 'dia', fecha: f })}
              />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1.5 }}>
                {Object.entries(NOMBRE_TIPO).map(([k, v]) => (
                  <Box key={k} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 12, color: 'text.secondary' }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: FONDO_TIPO[k], border: `1.5px solid ${COLOR_TIPO[k]}` }} />{v}
                  </Box>
                ))}
              </Box>
            </Box>
            {ancho && porConfirmar > 0 && (
              <Box sx={{ position: 'sticky', top: 12, maxHeight: 'calc(100dvh - 120px)', overflowY: 'auto' }}>
                <PorConfirmar alAbrir={(e) => setAbierto({ id: e.id })} soloLectura={soloLectura} alContar={setPorConfirmar} />
              </Box>
            )}
          </Box>
        )}
      </Container>
      <TarjetaEvento eventos={eventos} clave={tarjeta} alCerrar={() => setTarjeta(null)} alIr={setTarjeta} alFormulario={(e) => { setTarjeta(null); setAbierto({ id: e.id, ocurrencia: e.ocurrencia }) }} />
      <DialogoEvento abierto={abierto !== null} eventoId={abierto?.id} ocurrencia={abierto?.ocurrencia} alCerrar={() => setAbierto(null)} />
      <DialogoEvento
        abierto={nuevo !== null}
        inicial={nuevo ?? undefined}
        alCerrar={() => setNuevo(null)}
        alPegar={() => { setVinculosPegar((nuevo?.vinculos ?? []).map((x) => x.id)); setNuevo(null); setTextoPegar(''); setPegar(true) }}
      />
      <ElegirEntrada
        ancla={anclaNuevo}
        alCerrar={() => setAnclaNuevo(null)}
        tipo="agenda-actividades"
        alManual={() => setNuevo({ fecha: vista === 'dia' ? isoDia(fecha) : isoDia(new Date()) })}
        alPrompt={() => { setVinculosPegar([]); setTextoPegar(''); setPegar(true) }}
      />
      <DialogoPegarAgenda abierto={pegar} vinculos={vinculosPegar} textoInicial={textoPegar || undefined} alCerrar={() => { setPegar(false); setTextoPegar(''); setVinculosPegar([]) }} />
      <DialogoTarea abierto={tarea !== null} tareaId={tarea} alCerrar={() => setTarea(null)} />
      <DialogoImportar abierto={importar} que="ics" alCerrar={() => setImportar(false)} />
      <DialogoSuscripcion abierto={suscribir} alCerrar={() => setSuscribir(false)} />
    </Marco>
  )
}
