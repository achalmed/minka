/**
 * Lo escrito sin servidor que espera para enviarse, en su lugar (comentarios de una tarea, tareas nuevas): atenuado,
 * con un reloj, y desaparece cuando sale. La cola es del anfitrión (`apoyo.ts`: «sinconexion.*»); sola no hay cola y
 * la lista queda vacía. `alEnviarse` avisa a la pantalla para que relea su lista. Igual que EnEsperaLista de Qillqa.
 */
import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import ScheduleIcon from '@mui/icons-material/Schedule'
import { PALETA } from '@qillqa/tiqsi'
import { alCambiarCola, cuerpoDe, enEspera, type CambioPendiente } from './apoyo'

export function useEnEspera(ruta: string, filtro?: (cuerpo: Record<string, unknown>) => boolean, alEnviarse?: () => void): CambioPendiente[] {
  const filtroRef = useRef(filtro)
  filtroRef.current = filtro
  const alEnviarseRef = useRef(alEnviarse)
  alEnviarseRef.current = alEnviarse
  const [lista, setLista] = useState(() => enEspera(ruta, filtro))
  useEffect(() => {
    let previos = enEspera(ruta, filtroRef.current).length
    setLista(enEspera(ruta, filtroRef.current))
    return alCambiarCola(() => {
      const ahora = enEspera(ruta, filtroRef.current)
      if (ahora.length < previos) alEnviarseRef.current?.()
      previos = ahora.length
      setLista(ahora)
    })
  }, [ruta])
  return lista
}

export default function EnEsperaLista({ lista, campo = 'texto' }: { lista: CambioPendiente[]; campo?: string }) {
  if (lista.length === 0) return null
  return (
    <Box sx={{ display: 'grid', gap: 0.5, my: 0.5 }}>
      {lista.map((c) => (
        <Box key={c.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, px: 1, py: 0.5, borderRadius: 1, bgcolor: PALETA.superficieTenue, opacity: 0.8, fontSize: 13.5 }}>
          <ScheduleIcon sx={{ fontSize: 15, mt: '2px', color: PALETA.textoTenue, flexShrink: 0 }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box component="span" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{String(cuerpoDe(c)[campo] ?? '')}</Box>
            <Box component="span" sx={{ display: 'block', fontSize: 11, color: PALETA.textoTenue }}>En espera · se enviará al volver la conexión</Box>
          </Box>
        </Box>
      ))}
    </Box>
  )
}
