/**
 * Ver la agenda en otro calendario (Google Calendar, Outlook, el del celular, Thunderbird
 * o Super Productivity → Calendarios): una DIRECCIÓN SECRETA de solo lectura para
 * suscribirse, que se renueva (la anterior deja de servir) o se revoca aquí. También se
 * puede bajar el .ics una vez. Ver es de ida: lo que se cambie allá no vuelve a Qillqa.
 */
import { useEffect, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import Alert from '@mui/material/Alert'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DownloadIcon from '@mui/icons-material/Download'
import { api, descargarArchivo, confirmar } from '@qillqa/tiqsi'
import { mensajeError } from './datos'

export default function DialogoSuscripcion({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const [token, setToken] = useState<string | null>(null)
  const [usado, setUsado] = useState<string | null>(null)
  const [soloMias, setSoloMias] = useState(false)
  const [conTareas, setConTareas] = useState(true)
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!abierto) return
    setAviso('')
    setError('')
    api<{ token: string | null; usado_en: string | null }>('/api/agenda/token').then((r) => { setToken(r.token); setUsado(r.usado_en) }).catch((e) => setError(mensajeError(e)))
  }, [abierto])

  const url = token ? `${window.location.origin}/api/agenda.ics?token=${token}${soloMias ? '&solo_mias=true' : ''}${conTareas ? '&tareas=true' : ''}` : ''

  const renovar = async () => {
    if (token && !(await confirmar('La dirección actual dejará de funcionar en los calendarios donde la pegó. ¿Generar una nueva?', { aceptar: 'Generar', peligro: true }))) return
    try {
      const r = await api<{ token: string }>('/api/agenda/token', { method: 'POST' })
      setToken(r.token)
      setUsado(null)
      setAviso('Dirección nueva lista: cópiela en su calendario.')
    } catch (e) {
      setError(mensajeError(e))
    }
  }
  const revocar = async () => {
    if (!(await confirmar('¿Revocar la dirección? Los calendarios suscritos dejarán de actualizarse.', { aceptar: 'Revocar', peligro: true }))) return
    try {
      await api('/api/agenda/token', { method: 'DELETE' })
      setToken(null)
      setAviso('Dirección revocada.')
    } catch (e) {
      setError(mensajeError(e))
    }
  }
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setAviso('Dirección copiada.')
    } catch {
      setAviso('Seleccione la dirección y cópiela a mano.')
    }
  }

  return (
    <Dialog open={abierto} onClose={alCerrar} maxWidth="sm" fullWidth>
      <DialogTitle>Ver la agenda en otro calendario</DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          Pegue esta dirección en Google Calendar («Otros calendarios → Desde URL»), Outlook («Agregar calendario → Suscribirse desde la web»), el calendario del celular o Super Productivity («Calendarios»). Se actualiza sola; es de solo lectura. Es personal: quien la tenga ve la agenda, así que no la comparta; si se filtra, renuévela.
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <FormControlLabel control={<Switch checked={soloMias} onChange={(e) => setSoloMias(e.target.checked)} />} label="Solo donde participo" />
          <FormControlLabel control={<Switch checked={conTareas} onChange={(e) => setConTareas(e.target.checked)} />} label="Con mis tareas con plazo" />
        </Box>
        {token ? (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField size="small" fullWidth value={url} InputProps={{ readOnly: true }} onFocus={(e) => e.target.select()} inputProps={{ 'aria-label': 'Dirección del calendario' }} />
            <Button variant="contained" startIcon={<ContentCopyIcon />} onClick={() => void copiar()}>Copiar</Button>
          </Box>
        ) : (
          <Button variant="contained" onClick={() => void renovar()} sx={{ justifySelf: 'start' }}>Generar mi dirección</Button>
        )}
        {token && <Typography variant="caption" color="text.secondary">{usado ? `Último uso: ${new Date(usado).toLocaleString('es-PE')}` : 'Aún no la ha usado ningún calendario.'}</Typography>}
        {aviso && <Alert severity="success" onClose={() => setAviso('')}>{aviso}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button startIcon={<DownloadIcon />} onClick={() => void descargarArchivo(`/api/agenda/exportar.ics?solo_mias=${soloMias}&tareas=${conTareas}`, 'agenda.ics').catch((e) => setError(mensajeError(e)))} sx={{ mr: 'auto' }}>
          Bajar .ics
        </Button>
        {token && <Button color="error" onClick={() => void revocar()}>Revocar</Button>}
        {token && <Button onClick={() => void renovar()}>Renovar</Button>}
        <Button onClick={alCerrar}>Cerrar</Button>
      </DialogActions>
    </Dialog>
  )
}
