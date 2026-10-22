/**
 * CALENDARIO hecho a mano con MUI (sin librería): vistas de mes, semana y día, al modo
 * de Google Calendar. Los eventos que se superponen se reparten en carriles y los que
 * chocan llevan un borde de aviso. Las tareas con plazo se ven en su día (como en
 * Super Productivity), atenuadas. En el celular la semana se lee como lista por día
 * (siete columnas no caben) y el mes como puntos que llevan al día. Los feriados del Perú
 * marcan su día (número en rojo y su nombre); las fechas cívicas, solo su nombre.
 */
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import RepeatIcon from '@mui/icons-material/Repeat'
import AddIcon from '@mui/icons-material/Add'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import { PALETA } from '@qillqa/tiqsi'
import { DIAS_CORTOS, carriles, cuadriculaMes, diasDeLaSemana, esDeFranja, horaDe, isoDia, posicionEnDia, tituloDia, tramos, tresDias } from './calendario'
import MarcaCruce from './MarcaCruce'
import { tituloAgenda } from './rotuloAgenda'
import { COLOR_TIPO, FONDO_TIPO, NOMBRE_TIPO, type EventoAgenda, type Feriado, type Tarea } from './tipos'

export type VistaCalendario = 'mes' | 'semana' | 'tres' | 'dia'

const HORA_INI = 7
const HORA_FIN = 22
const ALTO_HORA = 48
const minAPx = (m: number) => (m / 60) * ALTO_HORA

interface Props {
  vista: VistaCalendario
  fecha: Date
  eventos: EventoAgenda[]
  tareas: Tarea[]
  /** Feriados y fechas cívicas del periodo, por día (AAAA-MM-DD). */
  feriados?: Record<string, Feriado[]>
  alAbrirEvento: (e: EventoAgenda) => void
  alAbrirTarea: (t: Tarea) => void
  alNuevo: (fecha: string, hora?: string) => void
  alIrADia: (fecha: string) => void
}

const eventosDelDia = (eventos: EventoAgenda[], dia: string) =>
  eventos.filter((e) => {
    const ini = isoDia(new Date(e.inicio))
    const fin = e.fin ? isoDia(new Date(new Date(e.fin).getTime() - (e.todo_el_dia ? 0 : 1))) : ini
    return ini <= dia && dia <= fin
  })

const esFeriado = (fs?: Feriado[]) => Boolean(fs?.some((f) => f.tipo !== 'civica'))

/** El nombre de los feriados y fechas cívicas de un día, en una línea. */
function NombresFeriado({ fs }: { fs?: Feriado[] }) {
  if (!fs?.length) return null
  return (
    <Typography
      variant="caption"
      title={fs.map((f) => `${f.nombre}${f.tipo === 'no_laborable' ? ' (no laborable)' : f.tipo === 'civica' ? '' : ' (feriado)'}`).join(' · ')}
      sx={{ display: 'block', px: 0.5, fontSize: 10.5, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: esFeriado(fs) ? PALETA.error : 'text.secondary', fontWeight: esFeriado(fs) ? 600 : 400, fontStyle: esFeriado(fs) ? 'normal' : 'italic' }}
    >
      {fs.map((f) => f.nombre).join(' · ')}
    </Typography>
  )
}

const tachado = (e: EventoAgenda) => e.estado === 'cancelado' || e.estado === 'suspendido'
/** Por confirmar (p. ej. detectado en un documento): borde punteado, sin relleno fuerte. */
const propuesto = (e: EventoAgenda) => e.estado === 'propuesto'
const POR_CONFIRMAR = ' · por confirmar'

function Pastilla({ e, alAbrir, compacta, entera, columnaCruce }: { e: EventoAgenda; alAbrir: () => void; compacta?: boolean; entera?: boolean; columnaCruce?: boolean }) {
  const color = COLOR_TIPO[e.tipo] ?? PALETA.textoTenue
  const fondo = FONDO_TIPO[e.tipo] ?? PALETA.superficieMedia
  // `entera` (la semana del celular, 2026-10-19): el título completo en varias líneas, la hora de
  // fin y el lugar debajo; nada cortado con «…». La del mes sigue en una línea (no hay sitio).
  // Sin caja, sin barra ni relleno (2026-10-19, «limpio, moderno, minimalista»): la hora lleva el
  // color del tipo; lo por confirmar, en cursiva tenue; el cruce, su icono.
  if (entera) {
    return (
      <ButtonBase
        onClick={(ev) => { ev.stopPropagation(); alAbrir() }}
        sx={{
          display: 'flex', alignItems: 'flex-start', gap: 1.5, width: '100%', justifyContent: 'flex-start', textAlign: 'left',
          px: 0.5, py: 0.75, borderRadius: 1.5, textDecoration: tachado(e) ? 'line-through' : 'none', opacity: tachado(e) ? 0.6 : 1,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {/* Título primero y la hora debajo (Edison, 2026-10-19 por la tarde). */}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 14.5, lineHeight: 1.35, overflowWrap: 'anywhere', color: propuesto(e) ? 'text.secondary' : 'text.primary', fontStyle: propuesto(e) ? 'italic' : 'normal' }}>
            {tituloAgenda(e.titulo)}
          </Typography>
          {/* Columnas fijas (Edison, 2026-10-19: «alineadas en la misma columna sin moverse»): la hora,
              la marca de cruce (si algún evento de la lista la lleva) y el lugar; nada se parte. */}
          <Typography variant="caption" component="div" sx={{ display: 'grid', gridTemplateColumns: columnaCruce ? '88px 46px minmax(0, 1fr)' : '88px minmax(0, 1fr)', columnGap: 0.75, alignItems: 'start', lineHeight: 1.3, mt: 0.15, color: 'text.secondary' }}>
            <Box component="span" sx={{ fontWeight: 700, whiteSpace: 'nowrap', color: propuesto(e) ? 'text.disabled' : color }}>{e.todo_el_dia ? 'Todo el día' : `${horaDe(e.inicio)}${e.fin ? `–${horaDe(e.fin)}` : ''}`}</Box>
            {columnaCruce && <Box component="span">{e.choque && <MarcaCruce />}</Box>}
            <Box component="span" sx={{ overflowWrap: 'anywhere' }}>{[e.lugar, propuesto(e) ? 'por confirmar' : ''].filter(Boolean).join(' · ')}</Box>
          </Typography>
        </Box>
      </ButtonBase>
    )
  }
  return (
    <ButtonBase
      onClick={(ev) => { ev.stopPropagation(); alAbrir() }}
      title={`${e.todo_el_dia ? 'Todo el día' : `${horaDe(e.inicio)}${e.fin ? `–${horaDe(e.fin)}` : ''}`} · ${e.titulo}${e.lugar ? ` · ${e.lugar}` : ''}${propuesto(e) ? POR_CONFIRMAR : ''}`}
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.5, width: '100%', justifyContent: 'flex-start', textAlign: 'left',
        px: 0.75, py: compacta ? 0.1 : 0.25, borderRadius: 1.5, fontSize: 11.5, lineHeight: 1.35, overflow: 'hidden',
        // Tarjeta pastel del tipo (2026-10-19): sin barra lateral ni contorno; el cruce, su pastilla.
        bgcolor: propuesto(e) ? 'transparent' : fondo, color: PALETA.texto,
        ...(propuesto(e) ? { border: `1px dashed ${color}` } : {}),
        textDecoration: tachado(e) ? 'line-through' : 'none', opacity: tachado(e) ? 0.6 : 1,
      }}
    >
      {e.choque && <MarcaCruce forma="punto" />}
      {!e.todo_el_dia && <Box component="span" sx={{ fontWeight: 600, flexShrink: 0, color }}>{horaDe(e.inicio)}</Box>}
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tituloAgenda(e.titulo)}</Box>
    </ButtonBase>
  )
}

/** Un evento de varios días: UNA barra de su primer a su último día visibles (2026-10-08).
 *  Con «‹ ›» si empieza antes o termina después de la fila. */
const ALTO_BARRA = 20
function Barra({ e, sigueAntes, sigueDespues, alAbrir }: { e: EventoAgenda; sigueAntes: boolean; sigueDespues: boolean; alAbrir: () => void }) {
  const color = COLOR_TIPO[e.tipo] ?? PALETA.textoTenue
  const fondo = FONDO_TIPO[e.tipo] ?? PALETA.superficieMedia
  return (
    <ButtonBase
      onClick={(ev) => { ev.stopPropagation(); alAbrir() }}
      title={`${e.titulo}${e.lugar ? ` · ${e.lugar}` : ''}${propuesto(e) ? POR_CONFIRMAR : ''}`}
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.5, width: '100%', height: ALTO_BARRA - 2, justifyContent: 'flex-start', textAlign: 'left',
        px: 0.75, fontSize: 11.5, fontWeight: 600, overflow: 'hidden',
        bgcolor: fondo, color: PALETA.texto,
        ...(propuesto(e) ? { border: `1px dashed ${color}`, bgcolor: 'transparent' } : {}),
        borderTopLeftRadius: sigueAntes ? 0 : 6, borderBottomLeftRadius: sigueAntes ? 0 : 6,
        borderTopRightRadius: sigueDespues ? 0 : 6, borderBottomRightRadius: sigueDespues ? 0 : 6,
        textDecoration: tachado(e) ? 'line-through' : 'none', opacity: tachado(e) ? 0.6 : 1,
      }}
    >
      {sigueAntes && <Box component="span" sx={{ opacity: 0.8 }}>‹</Box>}
      {!e.todo_el_dia && <Box component="span" sx={{ flexShrink: 0 }}>{horaDe(e.inicio)}</Box>}
      <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tituloAgenda(e.titulo)}</Box>
      {sigueDespues && <Box component="span" sx={{ opacity: 0.8 }}>›</Box>}
    </ButtonBase>
  )
}

function PastillaTarea({ t, alAbrir }: { t: Tarea; alAbrir: () => void }) {
  const hecha = t.estado === 'hecha'
  return (
    <ButtonBase
      onClick={(ev) => { ev.stopPropagation(); alAbrir() }}
      title={`Tarea: ${t.titulo}${t.responsable ? ` · ${t.responsable}` : ''}`}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%', minWidth: 0, overflow: 'hidden', justifyContent: 'flex-start', px: 0.5, py: 0.25, fontSize: 12.5, color: t.vencida ? PALETA.error : 'text.secondary', borderRadius: 1 }}
    >
      {hecha ? <CheckCircleOutlineIcon sx={{ fontSize: 13, flexShrink: 0 }} /> : <RadioButtonUncheckedIcon sx={{ fontSize: 13, flexShrink: 0 }} />}
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: hecha ? 'line-through' : 'none' }}>
        {t.vence_hora ? `${t.vence_hora} ` : ''}{t.titulo}
      </Box>
    </ButtonBase>
  )
}

function Mes({ fecha, eventos, tareas, feriados, alAbrirEvento, alAbrirTarea, alNuevo, alIrADia }: Omit<Props, 'vista'>) {
  const tema = useTheme()
  const celular = useMediaQuery(tema.breakpoints.down('sm'))
  const hoy = isoDia(new Date())
  const dias = cuadriculaMes(fecha)
  const mes = fecha.getMonth()
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: '1px solid', borderColor: 'divider', bgcolor: PALETA.superficieTenue }}>
        {DIAS_CORTOS.map((d) => <Typography key={d} variant="caption" sx={{ textAlign: 'center', py: 0.5, color: 'text.secondary', textTransform: 'uppercase', fontSize: 11 }}>{d}</Typography>)}
      </Box>
      {/* Por filas de semana: los eventos de varios días son UNA barra que cruza los días
          (2026-10-08), dibujada encima de la fila bajo el número del día. */}
      {Array.from({ length: dias.length / 7 }, (_, fila) => {
        const semana = dias.slice(fila * 7, fila * 7 + 7)
        const isos = semana.map(isoDia)
        const barras = celular ? [] : tramos(eventos, isos)
        const renglones = barras.reduce((m, t) => Math.max(m, t.renglon + 1), 0)
        return (
          <Box key={isos[0]} sx={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', minHeight: { xs: 64, sm: 112 }, borderBottom: fila < dias.length / 7 - 1 ? '1px solid' : 'none', borderColor: 'divider' }}>
            {semana.map((d, i) => {
              const iso = isos[i]
              const ev = eventosDelDia(eventos, iso).filter((e) => celular || !esDeFranja(e))
              const ts = tareas.filter((t) => t.vence_fecha === iso)
              const fs = feriados?.[iso]
              const total = ev.length + ts.length
              const max = Math.max(1, (fs?.length ? 2 : 3) - renglones)
              return (
                <Box
                  key={iso}
                  onClick={() => (celular ? alIrADia(iso) : alNuevo(iso))}
                  sx={{
                    borderRight: i < 6 ? '1px solid' : 'none', borderColor: 'divider',
                    p: 0.5, minWidth: 0, overflow: 'hidden', cursor: 'pointer', bgcolor: d.getMonth() !== mes ? PALETA.superficieTenue : 'transparent',
                    '&:hover': { bgcolor: PALETA.guindaSuave },
                  }}
                >
                  <ButtonBase
                    onClick={(e) => { e.stopPropagation(); alIrADia(iso) }}
                    sx={{
                      width: 24, height: 24, borderRadius: '50%', fontSize: 12, fontWeight: iso === hoy ? 700 : 500, mb: 0.25,
                      bgcolor: iso === hoy ? 'primary.main' : 'transparent',
                      color: iso === hoy ? 'primary.contrastText' : d.getMonth() !== mes ? 'text.disabled' : esFeriado(fs) ? PALETA.error : 'text.primary',
                    }}
                    aria-label={`Ver el ${tituloDia(d)}`}
                  >
                    {d.getDate()}
                  </ButtonBase>
                  {/* Sitio para las barras de varios días de esta semana. */}
                  {renglones > 0 && <Box sx={{ height: renglones * ALTO_BARRA }} />}
                  {!celular && <NombresFeriado fs={fs} />}
                  {celular ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4, px: 0.25 }}>
                      {ev.slice(0, 6).map((e) => <Box key={e.clave ?? e.id} sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: COLOR_TIPO[e.tipo] ?? PALETA.textoTenue }} />)}
                      {ts.length > 0 && <Box sx={{ width: 6, height: 6, borderRadius: '50%', border: `1.5px solid ${PALETA.apagado}` }} />}
                    </Box>
                  ) : (
                    <Box sx={{ display: 'grid', gap: 0.25 }}>
                      {ev.slice(0, max).map((e) => <Pastilla key={e.clave ?? e.id} e={e} compacta alAbrir={() => alAbrirEvento(e)} />)}
                      {ts.slice(0, Math.max(0, max - ev.length)).map((t) => <PastillaTarea key={t.id} t={t} alAbrir={() => alAbrirTarea(t)} />)}
                      {total > max && (
                        <Typography variant="caption" onClick={(e) => { e.stopPropagation(); alIrADia(iso) }} sx={{ px: 0.5, color: 'primary.main', fontWeight: 600, cursor: 'pointer' }}>
                          +{total - max} más
                        </Typography>
                      )}
                    </Box>
                  )}
                </Box>
              )
            })}
            {barras.map((t) => (
              <Box
                key={t.ev.clave ?? t.ev.id}
                sx={{
                  position: 'absolute', top: 30 + t.renglon * ALTO_BARRA, zIndex: 1, px: 0.5,
                  left: `${(t.desde / 7) * 100}%`, width: `${((t.hasta - t.desde + 1) / 7) * 100}%`,
                }}
              >
                <Barra e={t.ev} sigueAntes={t.sigueAntes} sigueDespues={t.sigueDespues} alAbrir={() => alAbrirEvento(t.ev)} />
              </Box>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}

/** Columnas de horas (semana o día) con los eventos posicionados. */
function Columnas({ dias, eventos, tareas, feriados, alAbrirEvento, alAbrirTarea, alNuevo, alIrADia }: Omit<Props, 'vista' | 'fecha'> & { dias: Date[] }) {
  const hoy = isoDia(new Date())
  const horas = Array.from({ length: HORA_FIN - HORA_INI }, (_, i) => HORA_INI + i)
  const ahora = new Date()
  const minutoAhora = ahora.getHours() * 60 + ahora.getMinutes() - HORA_INI * 60
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', bgcolor: 'background.paper' }}>
      {/* Cabecera: el día; los eventos de varios días como UNA barra de inicio a fin (2026-10-08);
          debajo, las tareas de cada día. Cuadrícula con columnas superpuestas para las líneas. */}
      {(() => {
        const isos = dias.map(isoDia)
        const barras = tramos(eventos, isos)
        const renglones = barras.reduce((m, t) => Math.max(m, t.renglon + 1), 0)
        const filaTareas = 2 + renglones + 1
        return (
          // overflowY + scrollbarGutter: la misma reserva de barra que el cuerpo con horas, o las
          // columnas de la cabecera quedan más anchas y las líneas no coinciden (2026-10-08).
          <Box sx={{ overflowY: 'hidden', scrollbarGutter: 'stable', display: 'grid', gridTemplateColumns: `44px repeat(${dias.length}, minmax(0, 1fr))`, gridTemplateRows: `auto ${renglones ? `repeat(${renglones}, ${ALTO_BARRA}px)` : ''} 4px auto`, borderBottom: '1px solid', borderColor: 'divider' }}>
            {isos.map((iso, i) => (
              <Box key={`linea-${iso}`} sx={{ gridColumn: i + 2, gridRow: '1 / -1', borderLeft: '1px solid', borderColor: 'divider' }} />
            ))}
            {dias.map((d, i) => {
              const iso = isos[i]
              return (
                <Box key={iso} sx={{ gridColumn: i + 2, gridRow: 1, p: 0.5, pb: 0.25, minWidth: 0 }}>
                  <ButtonBase onClick={() => alIrADia(iso)} sx={{ display: 'flex', gap: 0.5, alignItems: 'baseline', mb: 0.25, borderRadius: 1, px: 0.5 }}>
                    <Typography variant="caption" sx={{ textTransform: 'uppercase', color: 'text.secondary', fontSize: 11 }}>{DIAS_CORTOS[(d.getDay() + 6) % 7]}</Typography>
                    <Typography sx={{ fontWeight: 700, fontSize: 16, color: iso === hoy ? 'primary.main' : esFeriado(feriados?.[iso]) ? PALETA.error : 'text.primary' }}>{d.getDate()}</Typography>
                  </ButtonBase>
                  <NombresFeriado fs={feriados?.[iso]} />
                </Box>
              )
            })}
            {barras.map((t) => (
              <Box key={t.ev.clave ?? t.ev.id} sx={{ gridColumn: `${t.desde + 2} / ${t.hasta + 3}`, gridRow: t.renglon + 2, px: 0.5, minWidth: 0, zIndex: 1 }}>
                <Barra e={t.ev} sigueAntes={t.sigueAntes} sigueDespues={t.sigueDespues} alAbrir={() => alAbrirEvento(t.ev)} />
              </Box>
            ))}
            {dias.map((_, i) => {
              const iso = isos[i]
              const ts = tareas.filter((t) => t.vence_fecha === iso)
              return (
                <Box key={`t-${iso}`} sx={{ gridColumn: i + 2, gridRow: filaTareas, px: 0.5, pb: 0.5, minWidth: 0, overflow: 'hidden', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 0.25 }}>
                  {ts.slice(0, 4).map((t) => <PastillaTarea key={t.id} t={t} alAbrir={() => alAbrirTarea(t)} />)}
                  {ts.length > 4 && <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>+{ts.length - 4} tareas</Typography>}
                </Box>
              )
            })}
          </Box>
        )
      })()}
      <Box sx={{ maxHeight: { xs: '62vh', md: '68vh' }, overflowY: 'auto', scrollbarGutter: 'stable' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: `44px repeat(${dias.length}, minmax(0, 1fr))`, position: 'relative' }}>
          <Box>
            {horas.map((h) => (
              <Box key={h} sx={{ height: ALTO_HORA, textAlign: 'right', pr: 0.75, fontSize: 10.5, color: 'text.secondary', transform: 'translateY(-6px)' }}>
                {h > HORA_INI ? `${String(h).padStart(2, '0')}:00` : ''}
              </Box>
            ))}
          </Box>
          {dias.map((d) => {
            const iso = isoDia(d)
            // Los de varios días ya están arriba como barra.
            const conHora = eventosDelDia(eventos, iso).filter((e) => !esDeFranja(e))
            return (
              <Box key={iso} sx={{ position: 'relative', borderLeft: '1px solid', borderColor: 'divider', bgcolor: iso === hoy ? 'rgba(29,29,31,0.025)' : 'transparent' }}>
                {horas.map((h) => (
                  <Box
                    key={h}
                    onClick={() => alNuevo(iso, `${String(h).padStart(2, '0')}:00`)}
                    sx={{ height: ALTO_HORA, borderTop: '1px solid', borderColor: PALETA.borde, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                    title={`Agendar el ${tituloDia(d)} a las ${h}:00`}
                  />
                ))}
                {iso === hoy && minutoAhora > 0 && minutoAhora < (HORA_FIN - HORA_INI) * 60 && (
                  <Box sx={{ position: 'absolute', left: 0, right: 0, top: minAPx(minutoAhora), height: 2, bgcolor: PALETA.error, zIndex: 2, pointerEvents: 'none' }} />
                )}
                {carriles(conHora).map(({ ev, carril, de, ancho }) => {
                  const { desde, alto } = posicionEnDia(ev.inicio, ev.fin, iso, HORA_INI, HORA_FIN)
                  // El título va primero y la hora DEBAJO, con el bloque centrado (Edison, 2026-10-19 por la
                  // tarde: «las tarjetas centradas y la hora abajo; solo pedía que la hora aparezca en el
                  // celular»); el título toma las líneas que quedan; cada línea mide unos 14,5 px.
                  const altoPx = Math.max(18, minAPx(alto) - 2)
                  const lineasTotales = Math.max(1, Math.floor((altoPx - 7) / 14.5))
                  // Hora en su línea (sola, para que quepa en una columna angosta), el lugar en la suya si hay
                  // sitio, y el título con las líneas que quedan.
                  const conHora = lineasTotales >= 2
                  const conLugar = Boolean(ev.lugar) && lineasTotales >= 3
                  const lineas = Math.max(1, lineasTotales - (conHora ? 1 : 0) - (conLugar ? 1 : 0))
                  const color = COLOR_TIPO[ev.tipo] ?? PALETA.textoTenue
                  const fondo = FONDO_TIPO[ev.tipo] ?? PALETA.superficieMedia
                  return (
                    <Tooltip key={ev.clave ?? ev.id} title={`${NOMBRE_TIPO[ev.tipo] ?? ev.tipo}${ev.lugar ? ` · ${ev.lugar}` : ''}${ev.choque ? ' · coincide con otro evento' : ''}${propuesto(ev) ? POR_CONFIRMAR : ''}`}>
                      <ButtonBase
                        onClick={() => alAbrirEvento(ev)}
                        sx={{
                          position: 'absolute', top: minAPx(desde) + 1, height: altoPx,
                          left: `calc(${(carril / de) * 100}% + 2px)`, width: `calc(${(100 * ancho) / de}% - 4px)`,
                          // Columna centrada a media altura, como la agenda de referencia (2026-10-19).
                          display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', textAlign: 'left', overflow: 'hidden', borderRadius: 2, px: 0.75, py: 0.4, zIndex: 1,
                          // Tarjeta pastel del tipo, como la agenda de referencia (2026-10-19): sin barra ni contorno.
                          bgcolor: propuesto(ev) ? PALETA.superficie : fondo, color: PALETA.texto, boxShadow: `0 0 0 1px ${PALETA.superficie}`,
                          ...(propuesto(ev) ? { border: `1px dashed ${color}` } : {}),
                          textDecoration: tachado(ev) ? 'line-through' : 'none', opacity: tachado(ev) ? 0.6 : 1,
                        }}
                      >
                        {/* El cruce: un punto arena en la esquina del bloque (2026-10-19), fuera del título y de la hora. */}
                        {ev.choque && <MarcaCruce forma="esquina" />}
                        <Typography sx={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.25, display: 'flex', alignItems: 'flex-start', gap: 0.25 }}>
                          {ev.recurrencia && <RepeatIcon sx={{ fontSize: 11, color: 'text.secondary', mt: '2px' }} />}
                          <Box component="span" sx={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: lineas, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere', pr: ev.choque ? 1 : 0 }}>{tituloAgenda(ev.titulo)}</Box>
                        </Typography>
                        {conHora && (
                          <Typography noWrap sx={{ fontSize: 10.5, fontWeight: 600, color, lineHeight: 1.3, letterSpacing: -0.2, mt: 0.2 }}>
                            {horaDe(ev.inicio)}{ev.fin ? `–${horaDe(ev.fin)}` : ''}
                          </Typography>
                        )}
                        {conLugar && <Typography noWrap sx={{ fontSize: 10.5, color: 'text.secondary', lineHeight: 1.3 }}>{ev.lugar}</Typography>}
                      </ButtonBase>
                    </Tooltip>
                  )
                })}
              </Box>
            )
          })}
        </Box>
      </Box>
    </Box>
  )
}

/** La semana como lista por día (celular). */
function ListaSemana({ dias, eventos, tareas, feriados, alAbrirEvento, alAbrirTarea, alNuevo }: Omit<Props, 'vista' | 'fecha' | 'alIrADia'> & { dias: Date[] }) {
  const hoy = isoDia(new Date())
  // La columna del cruce se reserva en toda la lista si algún evento la necesita: así no se mueve.
  const hayCruce = eventos.some((e) => e.choque)
  return (
    <Box sx={{ display: 'grid', gap: 1.25, bgcolor: 'background.paper', borderRadius: 3, border: '1px solid', borderColor: PALETA.borde, p: 1.25 }}>
      {dias.map((d) => {
        const iso = isoDia(d)
        const ev = eventosDelDia(eventos, iso)
        const ts = tareas.filter((t) => t.vence_fecha === iso)
        return (
          // Cada día es un encabezado y sus filas, sin caja (2026-10-19); «+» agenda ese día.
          <Box key={iso} sx={{ pb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0.5, mb: 0.25 }}>
              <Typography sx={{ fontWeight: 700, fontSize: 15, flex: 1, '&::first-letter': { textTransform: 'uppercase' }, color: iso === hoy ? 'primary.main' : esFeriado(feriados?.[iso]) ? PALETA.error : 'text.primary' }}>{tituloDia(d)}</Typography>
              <IconButton size="small" onClick={() => alNuevo(iso)} aria-label={`Agendar el ${tituloDia(d)}`} sx={{ color: 'text.disabled' }}><AddIcon sx={{ fontSize: 18 }} /></IconButton>
            </Box>
            <Box sx={{ px: 0.5 }}><NombresFeriado fs={feriados?.[iso]} /></Box>
            {ev.length + ts.length === 0 && <Typography variant="caption" sx={{ display: 'block', px: 0.5, color: 'text.disabled' }}>Nada agendado</Typography>}
            <Box sx={{ display: 'grid', gap: 0.25 }}>
              {ev.map((e) => <Pastilla key={e.clave ?? e.id} e={e} entera columnaCruce={hayCruce} alAbrir={() => alAbrirEvento(e)} />)}
              {ts.map((t) => <PastillaTarea key={t.id} t={t} alAbrir={() => alAbrirTarea(t)} />)}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

export default function Calendario(p: Props) {
  const tema = useTheme()
  const celular = useMediaQuery(tema.breakpoints.down('sm'))
  if (p.vista === 'mes') return <Mes {...p} />
  if (p.vista === 'dia') return <Columnas {...p} dias={[p.fecha]} />
  // «3 días» (2026-10-19): la vista por omisión; en el celular, la misma lista por día que la semana.
  const dias = p.vista === 'tres' ? tresDias(p.fecha) : diasDeLaSemana(p.fecha)
  return celular ? <ListaSemana {...p} dias={dias} /> : <Columnas {...p} dias={dias} />
}
