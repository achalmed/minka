/**
 * TABLERO por estado (al modo de Trello): Por hacer · En curso · En espera · Hecha.
 * Se arrastra una tarjeta a otra columna (o encima de otra tarjeta para ordenarla);
 * en el celular las columnas se deslizan de lado y cada tarjeta tiene «Mover a…»,
 * porque arrastrar con el dedo en una lista que se desplaza es torpe. Las canceladas
 * no ocupan columna (se ven en la lista con «Hechas»).
 * 2026-10-18 («que no se vea saturado»): en cada columna van primero las que escribió una
 * persona y después, atenuadas, las automáticas del trámite; con las externas a la vista, una
 * primera columna «Por confirmar» trae las solicitudes de reunión (eventos sin confirmar).
 */
import { useState, type DragEvent } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import ButtonBase from '@mui/material/ButtonBase'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import ChecklistIcon from '@mui/icons-material/Checklist'
import LinkIcon from '@mui/icons-material/Link'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import { api, PALETA, avisar } from '@qillqa/tiqsi'
import { iniciales } from './apoyo'
import { avisarCambio, mensajeError } from './datos'
import { horaDe, isoDia, textoPlazo } from './calendario'
import { esAutomatica, ordenColumna } from './organizar'
import { COLOR_PRIORIDAD, ESTADOS_TAREA, type EventoAgenda, type EstadoTarea, type Tarea } from './tipos'

const COLUMNAS = ESTADOS_TAREA.filter((e) => e.clave !== 'cancelada')

function Tarjeta({ t, alAbrir, alMover, soloLectura, alArrastrar, marcarExterna }: {
  t: Tarea; alAbrir: () => void; alMover: (estado: EstadoTarea) => void; soloLectura: boolean; alArrastrar: (e: DragEvent) => void; marcarExterna: boolean
}) {
  const [ancla, setAncla] = useState<HTMLElement | null>(null)
  const hechos = t.checklist.filter((c) => c.hecha).length
  const auto = esAutomatica(t)
  return (
    <Box
      draggable={!soloLectura}
      onDragStart={alArrastrar}
      data-tarea={t.id}
      sx={{
        position: 'relative', border: '1px solid', borderColor: 'divider', borderRadius: 2.5,
        // Sin barra lateral (2026-10-19): la prioridad alta o urgente es un punto en la fila de datos.
        cursor: soloLectura ? 'default' : 'grab', '&:hover': { boxShadow: PALETA.sombra, opacity: 1 },
        // Las del trámite (automáticas) quedan atenuadas: se ven, pero no compiten con lo escrito a mano.
        opacity: auto ? 0.7 : 1, bgcolor: auto ? PALETA.superficieTenue : 'background.paper',
      }}
    >
      <ButtonBase onClick={alAbrir} sx={{ display: 'block', width: '100%', textAlign: 'left', p: auto ? 1 : 1.25, pr: 4 }}>
        <Typography sx={{ fontSize: auto ? 12.5 : 13.5, lineHeight: 1.4, ...(auto ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}), overflowWrap: 'anywhere', textDecoration: t.estado === 'hecha' ? 'line-through' : 'none', color: t.estado === 'hecha' ? 'text.secondary' : 'text.primary' }}>
          {t.titulo}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 0.75, fontSize: 11.5, color: 'text.secondary' }}>
          {(t.prioridad === 'alta' || t.prioridad === 'urgente') && (
            <Tooltip title={t.prioridad === 'urgente' ? 'Urgente' : 'Prioridad alta'}><Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: COLOR_PRIORIDAD[t.prioridad], flexShrink: 0 }} /></Tooltip>
          )}
          {marcarExterna && t.clase === 'externa' && (
            <Tooltip title="Externa"><GroupsOutlinedIcon sx={{ fontSize: 14, color: PALETA.dorado }} /></Tooltip>
          )}
          {t.vence_fecha && (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: t.vencida ? PALETA.error : 'inherit', fontWeight: t.vencida ? 600 : 400 }}>
              <EventOutlinedIcon sx={{ fontSize: 13 }} />{textoPlazo(t.vence_fecha, t.vence_hora, isoDia(new Date()))}
            </Box>
          )}
          {t.checklist.length > 0 && <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}><ChecklistIcon sx={{ fontSize: 13 }} />{hechos}/{t.checklist.length}</Box>}
          {t.vinculos.length > 0 && <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}><LinkIcon sx={{ fontSize: 13 }} />{t.vinculos.length}</Box>}
          {t.etiquetas.slice(0, 3).map((e) => <Box key={e} component="span" sx={{ color: PALETA.dorado }}>#{e}</Box>)}
          <Box sx={{ flex: 1 }} />
          <Tooltip title={t.responsable || 'Sin responsable'}>
            <Box component="span" sx={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 600, bgcolor: t.responsable ? PALETA.guindaSuave : 'transparent', color: t.responsable ? 'primary.main' : 'text.disabled', border: t.responsable ? 'none' : '1px dashed', borderColor: 'divider' }}>
              {t.responsable ? iniciales(t.responsable) : '?'}
            </Box>
          </Tooltip>
        </Box>
      </ButtonBase>
      {!soloLectura && (
        <>
          <IconButton size="small" onClick={(e) => setAncla(e.currentTarget)} aria-label={`Mover «${t.titulo}»`} sx={{ position: 'absolute', top: 4, right: 2 }}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
          <Menu anchorEl={ancla} open={Boolean(ancla)} onClose={() => setAncla(null)}>
            <MenuItem disabled sx={{ fontSize: 12.5 }}>Mover a…</MenuItem>
            {ESTADOS_TAREA.filter((e) => e.clave !== t.estado).map((e) => (
              <MenuItem key={e.clave} onClick={() => { setAncla(null); alMover(e.clave) }}>
                <Box component="span" sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: e.color, mr: 1 }} />{e.nombre}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </Box>
  )
}

/** Una solicitud de reunión (evento por confirmar) en la columna «Por confirmar». */
function TarjetaSolicitud({ e, alAbrir }: { e: EventoAgenda; alAbrir: () => void }) {
  const dia = new Date(e.inicio).toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' })
  return (
    <ButtonBase
      onClick={alAbrir}
      sx={{ display: 'block', width: '100%', textAlign: 'left', p: 1.25, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 2.5, '&:hover': { boxShadow: PALETA.sombra } }}
    >
      <Typography sx={{ fontSize: 13.5, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{e.titulo}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.75, fontSize: 11.5, color: e.pasado ? PALETA.error : 'text.secondary' }}>
        <EventOutlinedIcon sx={{ fontSize: 13 }} />{dia}{e.todo_el_dia ? '' : ` · ${horaDe(e.inicio)}`}
      </Box>
    </ButtonBase>
  )
}

export default function Tablero({ tareas, alAbrir, soloLectura, alCambiarLocal, solicitudes, alAbrirEvento, marcarExternas = false }: {
  tareas: Tarea[]
  alAbrir: (t: Tarea) => void
  soloLectura: boolean
  /** Actualización optimista: la página cambia su lista antes de que responda el servidor. */
  alCambiarLocal: (id: number, cambio: Partial<Tarea>) => void
  /** Solicitudes de reunión por confirmar (columna propia; null = no se muestra). */
  solicitudes?: EventoAgenda[] | null
  alAbrirEvento?: (e: EventoAgenda) => void
  /** Con todas las clases a la vista, un ícono tenue marca las externas. */
  marcarExternas?: boolean
}) {
  const [sobre, setSobre] = useState<EstadoTarea | null>(null)

  const mover = async (t: Tarea, estado: EstadoTarea, orden?: number) => {
    if (t.estado === estado && orden === undefined) return
    const columna = tareas.filter((x) => x.estado === estado && x.id !== t.id)
    const nuevoOrden = orden ?? (columna.length ? Math.max(...columna.map((x) => x.orden)) + 1 : 1)
    alCambiarLocal(t.id, { estado, orden: nuevoOrden })
    try {
      await api(`/api/tareas/${t.id}`, { method: 'PATCH', body: JSON.stringify({ estado, orden: nuevoOrden }) })
    } catch (e) {
      void avisar(mensajeError(e))
    }
    avisarCambio()
  }

  const soltar = (e: DragEvent, estado: EstadoTarea) => {
    e.preventDefault()
    setSobre(null)
    const id = Number(e.dataTransfer.getData('text/x-tarea'))
    const t = tareas.find((x) => x.id === id)
    if (!t) return
    // Encima de otra tarjeta: queda justo antes de ella.
    const destino = (e.target as HTMLElement).closest('[data-tarea]') as HTMLElement | null
    const otra = destino ? tareas.find((x) => x.id === Number(destino.dataset.tarea)) : undefined
    void mover(t, estado, otra && otra.id !== t.id ? otra.orden - 1 : undefined)
  }

  return (
    <Box
      sx={{
        display: 'grid', gridAutoFlow: 'column', gridAutoColumns: { xs: '85%', sm: 'minmax(240px, 1fr)' }, gap: 1.5,
        overflowX: 'auto', scrollSnapType: { xs: 'x mandatory', sm: 'none' }, pb: 1, alignItems: 'start',
      }}
    >
      {solicitudes && solicitudes.length > 0 && (
        <Box sx={{ scrollSnapAlign: 'start', bgcolor: PALETA.superficieMedia, borderRadius: 2.5, p: 1, minHeight: 120 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.5, pb: 1 }}>
            <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: PALETA.dorado }} />
            <Typography sx={{ fontWeight: 650, fontSize: 13.5 }}>Por confirmar</Typography>
            <Typography variant="caption" color="text.secondary">{solicitudes.length}</Typography>
          </Box>
          <Box sx={{ display: 'grid', gap: 1 }}>
            {solicitudes.map((e) => <TarjetaSolicitud key={e.id} e={e} alAbrir={() => alAbrirEvento?.(e)} />)}
          </Box>
        </Box>
      )}
      {COLUMNAS.map((c) => {
        const lista = ordenColumna(tareas.filter((t) => t.estado === c.clave))
        return (
          <Box
            key={c.clave}
            onDragOver={(e) => { if (!soloLectura) { e.preventDefault(); setSobre(c.clave) } }}
            onDragLeave={() => setSobre((s) => (s === c.clave ? null : s))}
            onDrop={(e) => soltar(e, c.clave)}
            sx={{
              scrollSnapAlign: 'start', bgcolor: sobre === c.clave ? PALETA.guindaSuave : PALETA.superficieMedia, borderRadius: 2.5, p: 1,
              border: '1px dashed', borderColor: sobre === c.clave ? 'primary.main' : 'transparent', minHeight: 120, transition: 'background-color .12s',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.5, pb: 1 }}>
              <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: c.color }} />
              <Typography sx={{ fontWeight: 650, fontSize: 13.5 }}>{c.nombre}</Typography>
              <Typography variant="caption" color="text.secondary">{lista.length}</Typography>
            </Box>
            <Box sx={{ display: 'grid', gap: 1 }}>
              {lista.map((t) => (
                <Tarjeta
                  key={t.id}
                  t={t}
                  marcarExterna={marcarExternas}
                  soloLectura={soloLectura}
                  alAbrir={() => alAbrir(t)}
                  alMover={(estado) => void mover(t, estado)}
                  alArrastrar={(e) => { e.dataTransfer.setData('text/x-tarea', String(t.id)); e.dataTransfer.effectAllowed = 'move' }}
                />
              ))}
              {lista.length === 0 && (
                <Typography variant="caption" color="text.disabled" sx={{ textAlign: 'center', py: 2 }}>
                  {soloLectura ? 'Sin tareas' : 'Arrastre una tarea aquí'}
                </Typography>
              )}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
