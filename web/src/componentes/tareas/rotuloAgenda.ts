/**
 * TÍTULOS DE LA AGENDA, uniformes (2026-10-19; Edison: «normalizar los nombres en las agendas para
 * que se vea uniforme: algunos están en todo mayúscula, otros todo minúscula»). Solo para MOSTRAR:
 * lo que la persona escribió se guarda tal cual y se edita tal cual.
 *
 * Regla: un título «gritado» (casi todo en mayúsculas) o todo en minúsculas pasa a la forma de los
 * demás —cada palabra con inicial mayúscula salvo los nexos (de, la, y…)—, conservando las siglas
 * conocidas (DREA, MINEDU, PL…), los números romanos y lo que lleva cifras. Un título ya mixto solo
 * recibe la inicial en mayúscula: el autor ya decidió el resto. Puro; pruebas en
 * `pruebas/rotuloAgenda.test.ts`.
 */

const NEXOS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'a', 'al', 'en', 'con', 'por', 'para', 'sobre', 'sin', 'ante', 'entre', 'hacia', 'hasta', 'un', 'una', 'unos', 'unas', 'que', 'se', 'su', 'sus', 'lo', 'ni'])

/** Siglas y nombres que van siempre en mayúsculas aunque el título llegue gritado. */
const SIGLAS = new Set(['DREA', 'DRE', 'UGEL', 'MINEDU', 'MINSA', 'MEF', 'MTC', 'INEI', 'PNP', 'CRP', 'CD', 'PL', 'MYPE', 'MN', 'ONU', 'OIT', 'BCRP', 'SUNAT', 'MIDIS', 'MIMP', 'MININTER', 'GORE', 'DIRESA', 'ESSALUD', 'SIS', 'ONPE', 'JNE', 'RENIEC', 'PCM', 'MTPE', 'PRODUCE', 'MINAM', 'MIDAGRI', 'MINAGRI', 'MVCS', 'MINEM', 'MINCUL', 'OSCE', 'SERVIR', 'SUNARP', 'INDECOPI', 'OEFA', 'IGP', 'SENAMHI', 'CGR', 'TC', 'PJ', 'MP', 'JNJ', 'UNSCH', 'UNMSM', 'UNI', 'PUCP', 'DNI', 'RUC', 'Qillqa', 'FONCODES', 'PRONABEC', 'QALI', 'WARMA', 'EIRL', 'SAC', 'SA', 'SRL', 'ONG', 'OIM', 'OMS', 'OPS', 'BID', 'CAF', 'PNUD', 'UNICEF', 'USAID', 'GIZ', 'FAO', 'CEPAL', 'OCDE', 'UE', 'EE', 'UU', 'FMI', 'BM', 'MML', 'CGTP', 'SUTEP', 'CONFIEP', 'SNI', 'ADEX', 'COMEX', 'AMPE', 'REMURPE', 'ANGR', 'PAD', 'STD', 'MDD', 'TDR', 'PIP', 'PIA', 'PIM', 'IGV', 'IR', 'ISC', 'FONCOMUN', 'CTI', 'ADN', 'IA', 'TIC', 'VRAEM', 'VRAE', 'OBS', 'PDF', 'DREA-AYACUCHO'])

const ROMANO = /^[IVXLCDM]+$/

const capitalizar = (w: string): string => (w ? w.charAt(0).toLocaleUpperCase('es') + w.slice(1).toLocaleLowerCase('es') : w)

/** Letras del texto (sin cifras ni signos). */
const letras = (t: string): string => t.replace(/[^\p{L}]/gu, '')

/** ¿Está escrito a gritos? ≥ 85 % de las letras en mayúscula y al menos dos palabras o doce letras. */
export function gritado(t: string): boolean {
  const l = letras(t)
  if (!l) return false
  const may = letras(t.toLocaleUpperCase('es')) === l ? l.length : [...l].filter((c) => c !== c.toLocaleLowerCase('es')).length
  const palabras = t.trim().split(/\s+/).length
  return may / l.length >= 0.85 && (palabras >= 2 || l.length >= 12)
}

/** Una palabra (puede traer comillas o paréntesis pegados) en forma de título. */
function palabra(w: string, primera: boolean): string {
  const m = /^([^\p{L}\d]*)(.*?)([^\p{L}\d]*)$/u.exec(w)
  if (!m) return w
  const [, antes, nucleo, despues] = m
  if (!nucleo) return w
  const arriba = nucleo.toLocaleUpperCase('es')
  let cuerpo: string
  if (SIGLAS.has(arriba) || ROMANO.test(arriba) || /\d/.test(nucleo)) cuerpo = arriba
  else if (!primera && NEXOS.has(nucleo.toLocaleLowerCase('es')) && !antes) cuerpo = nucleo.toLocaleLowerCase('es')
  else cuerpo = nucleo.split('-').map(capitalizar).join('-')
  return antes + cuerpo + despues
}

/** El título como se muestra en toda la agenda. */
export function tituloAgenda(t: string): string {
  const limpio = (t ?? '').replace(/\s+/g, ' ').trim()
  if (!limpio) return limpio
  const sinMayusculas = letras(limpio) === letras(limpio).toLocaleLowerCase('es')
  if (gritado(limpio) || sinMayusculas) {
    return limpio.split(' ').map((w, i) => palabra(w, i === 0)).join(' ')
  }
  // Mixto: solo la inicial.
  return limpio.charAt(0).toLocaleUpperCase('es') + limpio.slice(1)
}
