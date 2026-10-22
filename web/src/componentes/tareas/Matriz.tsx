/**
 * MATRIZ DE EISENHOWER (Edison 2026-10-08: «agregar la matriz de Eisenhower en agenda y tareas;
 * con solo llenar una tarea debe ir ordenándose sola en el calendario, en la matriz, en el
 * tablero…, similar a Super Productivity»).
 *
 * Nadie ordena aquí a mano: cada tarea cae en su cuadrante por su PLAZO (urgente = vence en 2
 * días o menos, o prioridad «urgente») y su IMPORTANCIA (marcada, o prioridad alta). Las tareas
 * que el sistema crea solo (recibidos, encargos, pasos del trámite) también llegan aquí.
 * Arrastrar una tarjeta a otro cuadrante cambia su importancia o su prioridad; el plazo no se
 * toca (si vence pronto, sigue siendo urgente y se avisa).
 */
import { useMemo, useState, type DragEvent } from 'react'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Typography from '@mui/material/Typography'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined'
import { api, PALETA, avisar } from '@qillqa/tiqsi'
import { avisarCambio, mensajeError } from './datos'
import { isoDia, textoPlazo } from './calendario'
import { cuadranteDe, type Cuadrante, type Prioridad, type Tarea } from './tipos'

const CUADRANTES: { clave: Cuadrante; titulo: string; ayuda: string; color: string }[] = [
  { clave: 'hacer', titulo: 'Hacer ahora', ayuda: 'Urgente e importante', color: PALETA.guinda },
  { clave: 'planificar', titulo: 'Planificar', ayuda: 'Importante, sin apuro', color: PALETA.dorado },
  { clave: 'delegar', titulo: 'Delegar', ayuda: 'Urgente, poco importante', color: PALETA.textoSecundario },
  { clave: 'despues', titulo: 'Después', ayuda: 'Ni urgente ni importante', color: PALETA.textoTenue },
]

/** Lo que cambia al soltar una tarjeta en un cuadrante (el plazo, nunca). */
function cambioPara(t: Tarea, destino: Cuadrante): { importante: boolean; prioridad: Prioridad } {
  const p = t.prioridad
  const porFecha = t.vence_en !== null && new Date(t.vence_en).getTime() <= Date.now() + 2 * 864e5
  switch (destino) {
    case 'hacer':
      return { importante: true, prioridad: porFecha ? p : 'urgente' }
    case 'planificar':
      return { importante: true, prioridad: p === 'urgente' ? 'alta' : p }
    case 'delegar':
      return { importante: false, prioridad: porFecha ? (p === 'alta' ? 'normal' : p) : 'urgente' }
    default:
      return { importante: false, prioridad: p === 'alta' || p === 'urgente' ? 'normal' : p }
  }
}

export default function Matriz({ tareas, alAbrir, soloLectura, alCambiarLocal }: {
  tareas: Tarea[]
  alAbrir: (t: Tarea) => void
  soloLectura: boolean
  alCambiarLocal: (id: number, cambio: Partial<Tarea>) => void
}) {
  const [sobre, setSobre] = useState<Cuadrante | null>(null)
  const abiertas = tareas.filter((t) => t.estado !== 'hecha' && t.estado !== 'cancelada')
  const por = useMemo(() => {
    const m: Record<Cuadrante, Tarea[]> = { hacer: [], planificar: [], delegar: [], despues: [] }
    for (const t of abiertas) m[t.cuadrante ?? cuadranteDe(t)].push(t)
    for (const k of Object.keys(m) as Cuadrante[]) {
      m[k].sort((a, b) => (a.vence_en ?? '9999').localeCompare(b.vence_en ?? '9999'))
    }
    return m
  }, [abiertas])
  const hoy = isoDia(new Date())

  const soltar = async (e: DragEvent, destino: Cuadrante) => {
    e.preventDefault()
    setSobre(null)
    const t = abiertas.find((x) => x.id === Number(e.dataTransfer.getData('text/x-tarea')))
    if (!t || (t.cuadrante ?? cuadranteDe(t)) === destino) return
    const cambio = cambioPara(t, destino)
    const queda = cuadranteDe({ ...t, ...cambio })
    alCambiarLocal(t.id, { ...cambio, cuadrante: queda })
    try {
      await api(`/api/tareas/${t.id}`, { method: 'PATCH', body: JSON.stringify(cambio) })
      if (queda !== destino) void avisar('Vence en menos de dos días: sigue siendo urgente. Cambie su plazo para moverla ahí.')
    } catch (err) {
      void avisar(mensajeError(err))
    }
    avisarCambio()
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
      {CUADRANTES.map((c) => (
        <Box
          key={c.clave}
          onDragOver={(e) => { if (!soloLectura) { e.preventDefault(); setSobre(c.clave) } }}
          onDragLeave={() => setSobre((s) => (s === c.clave ? null : s))}
          onDrop={(e) => void soltar(e, c.clave)}
          sx={{
            borderRadius: 2.5, border: '1px solid', borderColor: sobre === c.clave ? c.color : 'divider',
            bgcolor: sobre === c.clave ? PALETA.velo : 'background.paper', p: 1.25, minHeight: { md: 240 },
            borderTop: `3px solid ${c.color}`,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 14.5, color: c.color }}>{c.titulo}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>{c.ayuda}</Typography>
            <Typography variant="caption" color="text.secondary">{por[c.clave].length}</Typography>
          </Box>
          {por[c.clave].length === 0 && (
            <Typography variant="caption" color="text.disabled">Nada aquí.</Typography>
          )}
          <Box sx={{ display: 'grid', gap: 0.75, maxHeight: { md: 420 }, overflowY: 'auto' }}>
            {por[c.clave].map((t) => (
              <Box
                key={t.id}
                draggable={!soloLectura}
                onDragStart={(e) => { e.dataTransfer.setData('text/x-tarea', String(t.id)); e.dataTransfer.effectAllowed = 'move' }}
                sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: PALETA.superficieTenue, cursor: soloLectura ? 'default' : 'grab' }}
              >
                <ButtonBase onClick={() => alAbrir(t)} sx={{ display: 'block', width: '100%', textAlign: 'left', px: 1, py: 0.75 }}>
                  <Typography sx={{ fontSize: 13, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{t.titulo}</Typography>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.25, fontSize: 11.5, color: 'text.secondary', flexWrap: 'wrap' }}>
                    {t.vence_fecha && (
                      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: t.vencida ? PALETA.error : 'inherit', fontWeight: t.vencida ? 600 : 400 }}>
                        <EventOutlinedIcon sx={{ fontSize: 13 }} />{textoPlazo(t.vence_fecha, t.vence_hora, hoy)}
                      </Box>
                    )}
                    {t.responsable && <span>{t.responsable.split(' ')[0]}</span>}
                    {t.origen === 'automatica' && (
                      <Box component="span" title="La creó el sistema" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: PALETA.dorado }}>
                        <AutoAwesomeOutlinedIcon sx={{ fontSize: 12 }} />automática
                      </Box>
                    )}
                  </Box>
                </ButtonBase>
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}
