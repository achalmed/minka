/**
 * Una tarea en la lista (al modo de Todoist): el círculo la marca hecha (su borde lleva
 * el color de la prioridad), debajo el plazo —en vino si venció—, la lista, el
 * responsable, las etiquetas, los vínculos y el avance de su lista de verificación.
 * Pulsar el texto abre la ficha. `compacta` («Mis tareas», 2026-10-18: «hoy abruma»): el título
 * en dos líneas como mucho y debajo solo el plazo, el estado y el avance; lo demás, en la ficha.
 */
import { useEffect, useState, type ReactNode } from 'react'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'
import CheckIcon from '@mui/icons-material/Check'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import LinkIcon from '@mui/icons-material/Link'
import ChecklistIcon from '@mui/icons-material/Checklist'
import { api, PALETA, avisar } from '@qillqa/tiqsi'
import { iniciales } from './apoyo'
import { avisarCambio, mensajeError } from './datos'
import { isoDia, textoPlazo } from './calendario'
import { COLOR_ESTADO, COLOR_PRIORIDAD, NOMBRE_ESTADO, type Tarea } from './tipos'

export default function FilaTarea({ t, alAbrir, soloLectura, conResponsable = true, compacta = false, titulo }: {
  t: Tarea; alAbrir: () => void; soloLectura?: boolean; conResponsable?: boolean; compacta?: boolean
  /** Qué mostrar en vez del título entero (las del trámite se leen cortas, 2026-10-19). */
  titulo?: ReactNode
}) {
  const [hecha, setHecha] = useState(t.estado === 'hecha')
  useEffect(() => setHecha(t.estado === 'hecha'), [t.estado])
  const cerrada = t.estado === 'hecha' || t.estado === 'cancelada'
  const color = COLOR_PRIORIDAD[t.prioridad]

  const alternar = async () => {
    const nuevo = hecha ? 'por_hacer' : 'hecha'
    setHecha(!hecha)
    try {
      await api(`/api/tareas/${t.id}`, { method: 'PATCH', body: JSON.stringify({ estado: nuevo }) })
      avisarCambio()
    } catch (e) {
      setHecha(hecha)
      void avisar(mensajeError(e))
      avisarCambio()
    }
  }

  const hechos = t.checklist.filter((c) => c.hecha).length
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, px: 1, py: compacta ? 0.9 : 1, borderBottom: '1px solid', borderColor: compacta ? PALETA.borde : 'divider', borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}>
      <Tooltip title={soloLectura ? NOMBRE_ESTADO[t.estado] : hecha ? 'Marcar como pendiente' : 'Marcar como hecha'}>
        <span>
          <IconButton
            size="small"
            onClick={() => void alternar()}
            disabled={soloLectura || t.estado === 'cancelada'}
            aria-label={hecha ? `Reabrir «${t.titulo}»` : `Marcar hecha «${t.titulo}»`}
            sx={{
              // 2026-10-19: el círculo sin relleno; solo el borde dice la prioridad.
              mt: 0.1, width: 24, height: 24, border: '1.5px solid', borderColor: t.prioridad === 'normal' || t.prioridad === 'baja' ? PALETA.bordeFuerte : color,
              bgcolor: hecha ? PALETA.exito : 'transparent', color: PALETA.sobrePrimario,
              '&:hover': { bgcolor: hecha ? PALETA.exito : `${PALETA.exito}22`, '& svg': { opacity: 1 } },
            }}
          >
            <CheckIcon sx={{ fontSize: 16, opacity: hecha ? 1 : 0, color: hecha ? PALETA.sobrePrimario : PALETA.exito }} />
          </IconButton>
        </span>
      </Tooltip>
      <ButtonBase onClick={alAbrir} sx={{ flex: 1, minWidth: 0, display: 'block', textAlign: 'left', borderRadius: 1 }}>
        <Typography sx={{
          fontSize: 14.5, lineHeight: 1.4, textDecoration: hecha || cerrada ? 'line-through' : 'none', color: hecha || cerrada ? 'text.secondary' : 'text.primary', overflowWrap: 'anywhere',
          ...(compacta ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}),
        }}>
          {titulo ?? t.titulo}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.25, rowGap: 0.25, mt: 0.25, fontSize: 12, color: 'text.secondary', '&:empty': { display: 'none' } }}>
          {t.vence_fecha && (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: t.vencida ? PALETA.error : t.vence_fecha === isoDia(new Date()) ? PALETA.exito : 'inherit', fontWeight: t.vencida ? 600 : 400 }}>
              <EventOutlinedIcon sx={{ fontSize: 14 }} />{textoPlazo(t.vence_fecha, t.vence_hora, isoDia(new Date()))}
            </Box>
          )}
          {t.estado !== 'por_hacer' && !hecha && (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
              <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: COLOR_ESTADO[t.estado] }} />{NOMBRE_ESTADO[t.estado]}
            </Box>
          )}
          {t.checklist.length > 0 && (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}><ChecklistIcon sx={{ fontSize: 14 }} />{hechos}/{t.checklist.length}</Box>
          )}
          {!compacta && t.vinculos.length > 0 && (
            <Tooltip title={t.vinculos.map((v) => v.texto).join(' · ')}>
              {/* El texto va en su propio span: el «…» no sale sobre un flex (revisión celular 2026-10-12). */}
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, maxWidth: { xs: '100%', sm: 260 }, minWidth: 0 }}>
                <LinkIcon sx={{ fontSize: 14, flexShrink: 0 }} />
                <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.vinculos.length === 1 ? t.vinculos[0].texto : `${t.vinculos.length} vínculos`}
                </Box>
              </Box>
            </Tooltip>
          )}
          {!compacta && t.etiquetas.map((e) => <Box key={e} component="span" sx={{ color: PALETA.dorado }}>#{e}</Box>)}
          {!compacta && t.lista && (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
              <Box component="span" sx={{ width: 7, height: 7, borderRadius: 0.5, bgcolor: t.lista_color || PALETA.apagado }} />{t.lista}
            </Box>
          )}
        </Box>
      </ButtonBase>
      {conResponsable && (
        <Tooltip title={t.responsable ? `Responsable: ${t.responsable}` : 'Sin responsable'}>
          <Box sx={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, bgcolor: t.responsable ? PALETA.guindaSuave : 'transparent', color: t.responsable ? 'primary.main' : 'text.disabled', border: t.responsable ? 'none' : '1px dashed', borderColor: 'divider' }}>
            {t.responsable ? iniciales(t.responsable) : '?'}
          </Box>
        </Tooltip>
      )}
    </Box>
  )
}
