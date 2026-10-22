/**
 * La MARCA de un cruce de horario (2026-10-19, Edison: el triángulo de advertencia «se ve feo»; más
 * tarde: «que no invada la información, más sutil sin perder su importancia»). Tres formas, ninguna
 * dentro del título:
 *   - `columna`: una pastilla tenue «cruce» bajo la hora, en la columna de la izquierda de las listas
 *     (Inicio, semana y 3 días del celular);
 *   - `esquina`: un punto arena en la esquina superior derecha de un bloque del día o la semana;
 *   - `punto`: el punto antes de la hora en las pastillas de una línea (mes).
 * El aviso general de arriba es una línea con un punto arena (`LineaAtencion`), la misma gramática
 * que «por confirmar». Sin triángulos.
 */
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { PALETA } from '@qillqa/tiqsi'

export default function MarcaCruce({ forma = 'columna' }: { forma?: 'columna' | 'esquina' | 'punto' }) {
  if (forma === 'esquina') {
    return <Box component="span" aria-label="Cruce de horario" sx={{ position: 'absolute', top: 5, right: 5, width: 6, height: 6, borderRadius: '50%', bgcolor: PALETA.dorado }} />
  }
  if (forma === 'punto') {
    return <Box component="span" aria-label="Cruce de horario" sx={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', bgcolor: PALETA.dorado, flexShrink: 0 }} />
  }
  return (
    <Box
      component="span"
      aria-label="Cruce de horario"
      sx={{
        display: 'inline-block', px: 0.5, borderRadius: 0.75, whiteSpace: 'nowrap', verticalAlign: 'top',
        fontSize: 9, lineHeight: '13px', fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase',
        color: PALETA.avisoOscuro, bgcolor: PALETA.avisoFondo,
      }}
    >
      cruce
    </Box>
  )
}

/** Una línea tenue que avisa y lleva a donde está el asunto: punto arena, texto gris, flecha. */
export function LineaAtencion({ texto, alPulsar, sx }: { texto: string; alPulsar: () => void; sx?: object }) {
  return (
    <ButtonBase onClick={alPulsar} sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', alignItems: 'center', gap: 1, px: 2, py: 0.5, fontSize: 12.5, color: 'text.secondary', textAlign: 'left', ...sx }}>
      <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: PALETA.dorado, flexShrink: 0 }} />
      <Box component="span" sx={{ flex: 1 }}>{texto}</Box>
      <ChevronRightIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
    </ButtonBase>
  )
}
