/**
 * Crear desde una PLANTILLA (semana de representación, sesión de comisión, proyecto de
 * ley, pedido de información): una tarea con su lista de verificación o, con «una tarea
 * por paso», una lista nueva donde cada paso tiene su plazo calculado desde la fecha de
 * referencia. Los plazos ya no dependen de la memoria de nadie.
 */
import { useEffect, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import Alert from '@mui/material/Alert'
import ButtonBase from '@mui/material/ButtonBase'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import { api, PALETA } from '@qillqa/tiqsi'
import { avisarCambio, mensajeError, olvidarOpciones, useOpcionesTareas } from './datos'
import { desdeIso, isoDia, sumarDias, textoPlazo } from './calendario'
import SelectorVinculos from './SelectorVinculos'
import type { Vinculo } from './tipos'

export default function DialogoPlantilla({ abierto, alCerrar, vinculosIniciales = [] }: { abierto: boolean; alCerrar: () => void; vinculosIniciales?: Vinculo[] }) {
  const tema = useTheme()
  const celular = useMediaQuery(tema.breakpoints.down('sm'))
  const op = useOpcionesTareas()
  const [clave, setClave] = useState('semana_representacion')
  const [fecha, setFecha] = useState(isoDia(new Date()))
  const [titulo, setTitulo] = useState('')
  const [responsable, setResponsable] = useState<number | ''>('')
  const [separar, setSeparar] = useState(false)
  const [vinculos, setVinculos] = useState<Vinculo[]>(vinculosIniciales)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    if (abierto) {
      setError('')
      setVinculos(vinculosIniciales)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  const p = op?.plantillas.find((x) => x.clave === clave)
  const crear = async () => {
    setOcupado(true)
    setError('')
    try {
      await api('/api/tareas/desde-plantilla', {
        method: 'POST',
        body: JSON.stringify({ plantilla: clave, fecha_referencia: fecha, titulo, responsable_id: responsable || null, separar, vinculos: vinculos.map((v) => v.id) }),
      })
      if (separar) olvidarOpciones() // hay una lista nueva
      avisarCambio()
      alCerrar()
    } catch (e) {
      setError(mensajeError(e))
    } finally {
      setOcupado(false)
    }
  }

  const hoy = isoDia(new Date())
  return (
    <Dialog open={abierto} onClose={alCerrar} maxWidth="md" fullWidth fullScreen={celular}>
      <DialogTitle>Crear desde una plantilla</DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
        {error && <Alert severity="error">{error}</Alert>}
        <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } }}>
          {op?.plantillas.map((x) => (
            <ButtonBase
              key={x.clave}
              onClick={() => setClave(x.clave)}
              sx={{ display: 'block', textAlign: 'left', p: 1.5, borderRadius: 2, border: '1.5px solid', borderColor: clave === x.clave ? 'primary.main' : 'divider', bgcolor: clave === x.clave ? PALETA.guindaSuave : 'background.paper' }}
            >
              <Typography sx={{ fontWeight: 650, fontSize: 14.5 }}>{x.nombre}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12.5 }}>{x.descripcion}</Typography>
            </ButtonBase>
          ))}
        </Box>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <TextField type="date" label={p?.referencia ?? 'Fecha de referencia'} value={fecha} onChange={(e) => setFecha(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField select label="Responsable" value={responsable} onChange={(e) => setResponsable(e.target.value === '' ? '' : Number(e.target.value))}>
            <MenuItem value=""><em>Yo</em></MenuItem>
            {op?.usuarios.map((u) => <MenuItem key={u.id} value={u.id}>{u.nombre}</MenuItem>)}
          </TextField>
          <TextField label="Nombre (opcional)" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={p ? `${p.nombre} — ${fecha.split('-').reverse().join('/')}` : ''} sx={{ gridColumn: '1 / -1' }} />
        </Box>
        <SelectorVinculos valor={vinculos} alCambiar={setVinculos} />
        <FormControlLabel control={<Switch checked={separar} onChange={(e) => setSeparar(e.target.checked)} />} label={separar ? 'Una tarea por paso, cada una con su plazo (en una lista nueva)' : 'Una sola tarea con su lista de verificación'} />
        {p && fecha && (
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, bgcolor: PALETA.superficieTenue }}>
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Pasos</Typography>
            {p.pasos.map((s) => {
              const dia = isoDia(sumarDias(desdeIso(fecha), s.dias))
              return (
                <Box key={s.texto} sx={{ display: 'flex', gap: 1, fontSize: 13.5, py: 0.25 }}>
                  <Box sx={{ width: 92, flexShrink: 0, color: dia < hoy ? PALETA.error : 'text.secondary' }}>{textoPlazo(dia, null, hoy)}</Box>
                  <Box>{s.texto}</Box>
                </Box>
              )
            })}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={alCerrar}>Cancelar</Button>
        <Button variant="contained" onClick={() => void crear()} disabled={ocupado || !fecha}>Crear</Button>
      </DialogActions>
    </Dialog>
  )
}
