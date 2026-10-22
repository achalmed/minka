/**
 * IMPORTAR a Tareas y Agenda, siempre en dos pasos (simular, luego aplicar):
 *  - el respaldo JSON de Super Productivity (Ajustes → Sincronización y exportación →
 *    Exportar datos): sus tareas pendientes, con sus subtareas como lista de verificación,
 *    sus proyectos como listas y sus etiquetas;
 *  - un calendario .ics (Google Calendar, Outlook, una citación descargada).
 * Lo ya importado no se duplica (se reconoce por su identificador de origen).
 */
import { useEffect, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import LinearProgress from '@mui/material/LinearProgress'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { subirArchivo } from '@qillqa/tiqsi'
import { avisarCambio, mensajeError, olvidarOpciones } from './datos'
import { NOMBRE_TIPO } from './tipos'

interface Resumen {
  aplicado: boolean
  avisos: string[]
  muestra: Record<string, unknown>[]
  // Super Productivity
  tareas_nuevas?: number
  tareas_ya_importadas?: number
  listas_nuevas?: string[]
  omitidas?: number
  // ICS
  nuevos?: number
  ya_importados?: number
}

export default function DialogoImportar({ abierto, que, alCerrar }: { abierto: boolean; que: 'superproductivity' | 'ics'; alCerrar: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null)
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [hechas, setHechas] = useState(false)
  const [archivadas, setArchivadas] = useState(false)
  const [tipo, setTipo] = useState('otro')

  useEffect(() => {
    if (abierto) {
      setArchivo(null)
      setResumen(null)
      setError('')
    }
  }, [abierto])

  const enviar = async (aplicar: boolean, a = archivo) => {
    if (!a) return
    setOcupado(true)
    setError('')
    try {
      const datos = new FormData()
      datos.append('archivo', a)
      const ruta = que === 'superproductivity'
        ? `/api/tareas/importar/superproductivity?aplicar=${aplicar}&incluir_hechas=${hechas}&incluir_archivo=${archivadas}`
        : `/api/agenda/importar-ics?aplicar=${aplicar}&tipo=${tipo}`
      const r = await subirArchivo<Resumen>(ruta, datos)
      setResumen(r)
      if (aplicar) {
        olvidarOpciones()
        avisarCambio()
      }
    } catch (e) {
      setError(mensajeError(e))
    } finally {
      setOcupado(false)
    }
  }

  const nuevos = que === 'superproductivity' ? resumen?.tareas_nuevas ?? 0 : resumen?.nuevos ?? 0
  const ya = que === 'superproductivity' ? resumen?.tareas_ya_importadas ?? 0 : resumen?.ya_importados ?? 0
  return (
    <Dialog open={abierto} onClose={alCerrar} maxWidth="sm" fullWidth>
      <DialogTitle>{que === 'superproductivity' ? 'Importar de Super Productivity' : 'Importar un calendario (.ics)'}</DialogTitle>
      {ocupado && <LinearProgress />}
      <DialogContent dividers sx={{ display: 'grid', gap: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          {que === 'superproductivity'
            ? 'Exporte desde Super Productivity (Ajustes → Sincronización y exportación → Exportar datos) y elija el .json.'
            : 'Un archivo .ics de Google Calendar, Outlook u otro sistema. Primero verá qué eventos se traerían; lo ya importado no se repite.'}
        </Typography>
        {que === 'superproductivity' ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <FormControlLabel control={<Switch checked={hechas} onChange={(e) => { setHechas(e.target.checked); setResumen(null) }} />} label="También las hechas" />
            <FormControlLabel control={<Switch checked={archivadas} onChange={(e) => { setArchivadas(e.target.checked); setResumen(null) }} />} label="También el archivo" />
          </Box>
        ) : (
          <TextField select size="small" label="Tipo de los eventos importados" value={tipo} onChange={(e) => { setTipo(e.target.value); setResumen(null) }} sx={{ maxWidth: 320 }}>
            {Object.entries(NOMBRE_TIPO).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
          </TextField>
        )}
        <Button component="label" variant="outlined" startIcon={<UploadFileIcon />} sx={{ justifySelf: 'start' }}>
          {archivo ? archivo.name : 'Elegir archivo'}
          <input
            hidden
            type="file"
            accept={que === 'superproductivity' ? '.json,application/json' : '.ics,text/calendar'}
            onChange={(e) => {
              const a = e.target.files?.[0] ?? null
              setArchivo(a)
              setResumen(null)
              if (a) void enviar(false, a)
            }}
          />
        </Button>
        {error && <Alert severity="error">{error}</Alert>}
        {resumen && (
          <Alert severity={resumen.aplicado ? 'success' : 'info'}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {resumen.aplicado ? `Importado: ${nuevos} ${que === 'superproductivity' ? 'tarea(s)' : 'evento(s)'}.` : `Se traerían ${nuevos} ${que === 'superproductivity' ? 'tarea(s)' : 'evento(s)'}.`}
              {ya > 0 && ` ${ya} ya estaban.`}
              {resumen.omitidas ? ` ${resumen.omitidas} omitida(s) (hechas o sin título).` : ''}
            </Typography>
            {resumen.listas_nuevas && resumen.listas_nuevas.length > 0 && <Typography variant="body2">Listas nuevas: {resumen.listas_nuevas.join(', ')}</Typography>}
            {!resumen.aplicado && resumen.muestra.length > 0 && (
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5, fontSize: 13 }}>
                {resumen.muestra.slice(0, 10).map((m, i) => <li key={i}>{String(m.titulo)}{m.vence ? ` · ${String(m.vence).slice(0, 10)}` : ''}{m.inicio ? ` · ${String(m.inicio).slice(0, 16).replace('T', ' ')}` : ''}</li>)}
              </Box>
            )}
            {resumen.avisos.length > 0 && (
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5, fontSize: 12.5, color: 'text.secondary' }}>
                {resumen.avisos.slice(0, 8).map((a) => <li key={a}>{a}</li>)}
              </Box>
            )}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={alCerrar}>{resumen?.aplicado ? 'Cerrar' : 'Cancelar'}</Button>
        {!resumen?.aplicado && <Button variant="contained" disabled={!archivo || !resumen || nuevos === 0 || ocupado} onClick={() => void enviar(true)}>Importar</Button>}
      </DialogActions>
    </Dialog>
  )
}
