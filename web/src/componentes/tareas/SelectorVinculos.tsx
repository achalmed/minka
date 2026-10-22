/**
 * Vincular una tarea o un evento con lo demás del sistema (documento, proyecto de ley,
 * semana SR, pedido, persona, institución). Busca con el mismo buscador de las citas
 * (`GET /api/referencias/buscar`), así que encuentra lo mismo que «Ley …», «Oficio …» o
 * «@persona» en el editor. Cada vínculo es una chip que lleva a su ficha.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import Autocomplete from '@mui/material/Autocomplete'
import TextField from '@mui/material/TextField'
import Chip from '@mui/material/Chip'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import LinkIcon from '@mui/icons-material/Link'
import { buscarReferencias } from './apoyo'
import { NOMBRE_PREFIJO, PREFIJO_REFERENCIA, rutaVinculo } from './calendario'
import type { Vinculo } from './tipos'

interface Resultado {
  tipo: string
  id: string
  etiqueta: string
  detalle: string
  grupo: string
}

interface Opcion extends Vinculo {
  grupo: string
  detalle: string
}

export default function SelectorVinculos({ valor, alCambiar, deshabilitado }: { valor: Vinculo[]; alCambiar: (v: Vinculo[]) => void; deshabilitado?: boolean }) {
  const navegar = useNavigate()
  const [texto, setTexto] = useState('')
  const [opciones, setOpciones] = useState<Opcion[]>([])
  const [cargando, setCargando] = useState(false)
  const turno = useRef(0)

  useEffect(() => {
    const q = texto.trim()
    if (q.length < 2) {
      setOpciones([])
      return
    }
    const mio = ++turno.current
    setCargando(true)
    const t = window.setTimeout(() => {
      buscarReferencias<Resultado>(q, 'tarea')
        .then((r) => {
          if (mio !== turno.current) return
          setOpciones(
            r.filter((x) => PREFIJO_REFERENCIA[x.tipo]).map((x) => ({
              id: `${PREFIJO_REFERENCIA[x.tipo]}:${x.id}`,
              texto: x.etiqueta,
              grupo: NOMBRE_PREFIJO[PREFIJO_REFERENCIA[x.tipo]] ?? x.grupo,
              detalle: x.detalle,
            })),
          )
        })
        .catch(() => setOpciones([]))
        .finally(() => mio === turno.current && setCargando(false))
    }, 250)
    return () => window.clearTimeout(t)
  }, [texto])

  return (
    <Autocomplete<Opcion | Vinculo, true, false, false>
      multiple
      disabled={deshabilitado}
      options={opciones}
      value={valor}
      loading={cargando}
      filterOptions={(x) => x}
      groupBy={(o) => ('grupo' in o ? o.grupo : '')}
      getOptionLabel={(o) => o.texto}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_, v) => alCambiar(v.map((x) => ({ id: x.id, texto: x.texto })))}
      inputValue={texto}
      onInputChange={(_, v, motivo) => motivo !== 'reset' && setTexto(v)}
      noOptionsText={texto.trim().length < 2 ? 'Escriba parte del número, título o nombre' : 'Sin resultados'}
      loadingText="Buscando…"
      renderOption={(props, o) => (
        <li {...props} key={o.id}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 14 }} noWrap>{o.texto}</Typography>
            {'detalle' in o && o.detalle && <Typography variant="caption" color="text.secondary" noWrap component="div">{o.detalle}</Typography>}
          </Box>
        </li>
      )}
      renderTags={(lista, props) =>
        lista.map((v, i) => {
          const ruta = rutaVinculo(v.id)
          const { key, ...resto } = props({ index: i })
          return (
            <Chip
              key={key}
              {...resto}
              size="small"
              icon={<LinkIcon sx={{ fontSize: '16px !important' }} />}
              label={v.texto}
              title={`${NOMBRE_PREFIJO[v.id.split(':')[0]] ?? ''}: ${v.texto}`}
              onClick={ruta ? () => navegar(ruta) : undefined}
              sx={{ maxWidth: 280 }}
            />
          )
        })
      }
      renderInput={(params) => (
        <TextField {...params} label="Vinculada a" placeholder={valor.length ? '' : 'Documento, proyecto de ley, semana, persona, institución…'} size="small" />
      )}
    />
  )
}
