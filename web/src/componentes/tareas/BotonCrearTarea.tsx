/**
 * «Crear tarea» desde cualquier cosa del sistema (documento, proyecto de ley, semana,
 * persona, institución): abre la ficha de tarea nueva ya VINCULADA a eso. Es la
 * respuesta a los encargos en infinitivo del chat («revisar», «responder», «agendar»):
 * un clic donde está el trabajo y la tarea nace con responsable, plazo y vínculo.
 *
 *   <BotonCrearTarea vinculo={`doc:${id}`} texto="Oficio N° 0012" compacto />
 *
 * `compacto` = solo el icono (barras y tarjetas); sin él, botón con texto.
 * Entrada doble (fase 9.5): la ficha a mano o el resultado del prompt de plan de tareas
 * (`plan-de-tareas`), con todas las tareas pegadas vinculadas a lo mismo.
 */
import { useState } from 'react'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import AddTaskIcon from '@mui/icons-material/AddTask'
import DialogoTarea from './DialogoTarea'
import DialogoPegarTareas from './DialogoPegarTareas'
import { ElegirEntrada, hay } from '@qillqa/tiqsi'
import { puedeEscribir, type Tarea } from './tipos'

export default function BotonCrearTarea({ vinculo, texto, compacto, titulo, alCrear }: {
  /** Identificador del mapa: `doc:12`, `pl:3`, `sr:2`, `persona:7`, `inst:4`. */
  vinculo: string
  /** Cómo se lee lo vinculado (la chip del vínculo). */
  texto: string
  compacto?: boolean
  /** Título sugerido de la tarea (p. ej. «Responder …»). */
  titulo?: string
  alCrear?: (t: Tarea) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [ancla, setAncla] = useState<HTMLElement | null>(null)
  const [pegar, setPegar] = useState(false)
  if (!puedeEscribir()) return null
  return (
    <>
      {compacto ? (
        <Tooltip title={`Crear una tarea vinculada a ${texto}`}>
          <IconButton size="small" onClick={(e) => (hay('ElegirEntrada') ? setAncla(e.currentTarget) : setAbierto(true))} aria-label="Crear tarea vinculada">
            <AddTaskIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : (
        <Button size="small" startIcon={<AddTaskIcon />} onClick={(e) => (hay('ElegirEntrada') ? setAncla(e.currentTarget) : setAbierto(true))}>Crear tarea</Button>
      )}
      <ElegirEntrada ancla={ancla} alCerrar={() => setAncla(null)} tipo="plan-de-tareas" alManual={() => setAbierto(true)} alPrompt={() => setPegar(true)} />
      {pegar && <DialogoPegarTareas abierto vinculo={vinculo} alCerrar={() => setPegar(false)} alRegistrado={() => undefined} />}
      {abierto && (
        <DialogoTarea
          abierto
          inicial={{ vinculos: [{ id: vinculo, texto }], ...(titulo ? { titulo } : {}) }}
          alCerrar={() => setAbierto(false)}
          alGuardar={alCrear}
        />
      )}
    </>
  )
}
