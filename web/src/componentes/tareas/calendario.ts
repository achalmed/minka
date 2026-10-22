/**
 * Cuentas PURAS del módulo Tareas y Agenda (2026-10-06): días de la semana y del mes,
 * posición de un evento en la columna del día, carriles de los que se superponen,
 * el texto del plazo de una tarea y la ruta de cada vínculo. Sin React ni API: se
 * prueban con `node --test pruebas/*.test.ts` (pruebas/calendario.test.ts).
 *
 * Todo se calcula con la hora LOCAL del navegador (la del despacho): un día es
 * AAAA-MM-DD local, nunca `toISOString()` (que es la de Greenwich: de noche ya
 * sería mañana).
 */

export const DIAS_CORTOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
export const DIAS_LARGOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** AAAA-MM-DD con la hora local. */
export const isoDia = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Fecha local a medianoche desde AAAA-MM-DD. */
export const desdeIso = (iso: string): Date => {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(a, m - 1, d)
}

export const sumarDias = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** 0 = lunes … 6 = domingo (el calendario del despacho empieza en lunes). */
export const diaSemana = (d: Date): number => (d.getDay() + 6) % 7

export const inicioSemana = (d: Date): Date => sumarDias(d, -diaSemana(d))

/** Tres días desde la fecha (2026-10-19, Edison: «de forma predeterminada solo 3 días, con 7 no se ven las tarjetas»). */
export const tresDias = (d: Date): Date[] => Array.from({ length: 3 }, (_, i) => sumarDias(d, i))

export const diasDeLaSemana = (d: Date): Date[] => {
  const lunes = inicioSemana(d)
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i))
}

/** Las 6 semanas (42 días) que muestran un mes, de lunes a domingo. */
export const cuadriculaMes = (d: Date): Date[] => {
  const primero = new Date(d.getFullYear(), d.getMonth(), 1)
  const lunes = inicioSemana(primero)
  return Array.from({ length: 42 }, (_, i) => sumarDias(lunes, i))
}

/** «lunes 6 de octubre», «6 – 12 de octubre de 2026», «octubre de 2026». */
export const tituloDia = (d: Date): string => `${DIAS_LARGOS[diaSemana(d)]} ${d.getDate()} de ${MESES[d.getMonth()]}`
export const tituloMes = (d: Date): string => `${MESES[d.getMonth()]} de ${d.getFullYear()}`
const tituloRango = (a: Date, b: Date): string =>
  a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${b.getDate()} de ${MESES[b.getMonth()]} de ${b.getFullYear()}`
    : `${a.getDate()} ${MESES_CORTOS[a.getMonth()]} – ${b.getDate()} ${MESES_CORTOS[b.getMonth()]} ${b.getFullYear()}`
export const tituloSemana = (d: Date): string => tituloRango(inicioSemana(d), sumarDias(inicioSemana(d), 6))
export const tituloTresDias = (d: Date): string => tituloRango(d, sumarDias(d, 2))

/** «15:00» de una fecha ISO con zona, en la hora local. */
export const horaDe = (iso: string): string => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Minutos desde la medianoche local. */
export const minutosDe = (iso: string): number => {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * Posición vertical (en minutos del día visible) de un evento: `desde` y `alto`, recortados
 * a la franja [horaIni, horaFin). Sin fin, una hora. Un evento que empezó el día anterior
 * arranca arriba.
 */
export function posicionEnDia(inicio: string, fin: string | null, dia: string, horaIni = 7, horaFin = 22): { desde: number; alto: number } {
  const i = isoDia(new Date(inicio)) < dia ? 0 : minutosDe(inicio)
  let f = fin ? (isoDia(new Date(fin)) > dia ? 24 * 60 : minutosDe(fin)) : i + 60
  if (f <= i) f = i + 30
  const lo = horaIni * 60
  const hi = horaFin * 60
  const desde = Math.max(lo, Math.min(i, hi - 30))
  const hasta = Math.max(desde + 20, Math.min(f, hi))
  return { desde: desde - lo, alto: hasta - desde }
}

/**
 * Carriles para los eventos de un día que se superponen (como Google Calendar): cada
 * evento recibe su carril y cuántos carriles tiene su grupo de superpuestos.
 */
export function carriles<T extends { inicio: string; fin: string | null }>(eventos: T[]): { ev: T; carril: number; de: number; ancho: number }[] {
  const orden = [...eventos].sort((a, b) => a.inicio.localeCompare(b.inicio))
  const ini = (e: T) => new Date(e.inicio).getTime()
  const fin = (e: T) => (e.fin ? new Date(e.fin).getTime() : new Date(e.inicio).getTime() + 3600_000)
  const salida: { ev: T; carril: number; de: number; ancho: number }[] = []
  let grupo: { ev: T; carril: number; de: number; ancho: number }[] = []
  let finGrupo = -Infinity
  const cerrar = () => {
    const n = Math.max(1, ...grupo.map((g) => g.carril + 1))
    for (const g of grupo) {
      g.de = n
      // Como Google Calendar (2026-10-19, Edison: «hay un espacio que se puede aprovechar»): el
      // bloque se extiende por los carriles de su derecha mientras ningún otro del grupo los ocupe
      // a esa misma hora.
      let c = g.carril + 1
      while (c < n && !grupo.some((o) => o.carril === c && ini(o.ev) < fin(g.ev) && fin(o.ev) > ini(g.ev))) c++
      g.ancho = c - g.carril
    }
    salida.push(...grupo)
    grupo = []
  }
  for (const e of orden) {
    const i = ini(e)
    if (i >= finGrupo && grupo.length) cerrar()
    const ocupados = new Set(grupo.filter((g) => fin(g.ev) > i).map((g) => g.carril))
    let c = 0
    while (ocupados.has(c)) c++
    grupo.push({ ev: e, carril: c, de: 1, ancho: 1 })
    finGrupo = Math.max(finGrupo, fin(e))
  }
  if (grupo.length) cerrar()
  return salida
}

/** El plazo de una tarea como se lee: «Hoy 15:00», «Mañana», «Ayer», «vie 9 oct», «9 oct 2027». */
export function textoPlazo(fecha: string | null, hora: string | null, hoy: string): string {
  if (!fecha) return ''
  const d = desdeIso(fecha)
  const dif = Math.round((d.getTime() - desdeIso(hoy).getTime()) / 86_400_000)
  let t: string
  if (dif === 0) t = 'Hoy'
  else if (dif === 1) t = 'Mañana'
  else if (dif === -1) t = 'Ayer'
  else if (dif > 1 && dif < 7) t = `${DIAS_CORTOS[diaSemana(d)]} ${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`
  else if (d.getFullYear() === desdeIso(hoy).getFullYear()) t = `${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`
  else t = `${d.getDate()} ${MESES_CORTOS[d.getMonth()]} ${d.getFullYear()}`
  return hora ? `${t} ${hora}` : t
}

/** Ruta interna de un vínculo (`doc:12` → /documentos/12). */
export function rutaVinculo(id: string): string | null {
  const [p, n] = id.split(':')
  switch (p) {
    case 'doc': return `/documentos/${n}`
    case 'pl': return `/proyectos/${n}`
    case 'sr': return `/informes/${n}`
    case 'persona': return `/directorio?contacto=${n}`
    case 'inst': return `/directorio?pestana=instituciones&ver=${n}`
    case 'foto': return '/fototeca'
    case 'tarea': return `/tareas?abrir=${n}`
    case 'evento': return `/agenda?abrir=${n}`
    case 'entrada': return `/recibidos?ver=${n}`
    case 'rend': return `/rendiciones/${n}`
    default: return null
  }
}

/** Prefijo del vínculo para un resultado del buscador de referencias (`GET /api/referencias/buscar`). */
export const PREFIJO_REFERENCIA: Record<string, string> = {
  documento: 'doc',
  proyecto: 'pl',
  semana: 'sr',
  pedido: 'pedido',
  persona: 'persona',
  institucion: 'inst',
  entrada: 'entrada',
}

export const NOMBRE_PREFIJO: Record<string, string> = {
  doc: 'Documento',
  pl: 'Proyecto de ley',
  sr: 'Semana de representación',
  pedido: 'Pedido',
  persona: 'Persona',
  inst: 'Institución',
  foto: 'Foto',
  tarea: 'Tarea',
  evento: 'Evento',
  entrada: 'Recibido',
}

/** Recurrencia en palabras: «cada semana: mar, mié · hasta el 15/12». */
export function textoRecurrencia(r: { frecuencia: string; intervalo?: number; dias?: number[]; hasta?: string | null } | null): string {
  if (!r) return ''
  const dias = r.dias && r.dias.length ? r.dias : []
  const base = r.frecuencia === 'diaria' || dias.length === 7
    ? 'todos los días'
    : `${(r.intervalo ?? 1) > 1 ? `cada ${r.intervalo} semanas` : 'cada semana'}${dias.length ? `: ${dias.map((d) => DIAS_CORTOS[d]).join(', ')}` : ''}`
  return r.hasta ? `${base} · hasta el ${r.hasta.slice(8, 10)}/${r.hasta.slice(5, 7)}` : base
}

/** Días (AAAA-MM-DD) que ocupa un evento: el fin de uno de todo el día es inclusivo; el de uno
 *  con hora, hasta el minuto anterior (termina a las 00:00 = el día anterior). */
export function diasDelEvento(e: { inicio: string; fin: string | null; todo_el_dia: boolean }): [string, string] {
  const ini = isoDia(new Date(e.inicio))
  const fin = e.fin ? isoDia(new Date(new Date(e.fin).getTime() - (e.todo_el_dia ? 0 : 1))) : ini
  return [ini, fin < ini ? ini : fin]
}

/** ¿Va en la franja de arriba como barra? Los de todo el día y los que cruzan de un día a otro. */
export const esDeFranja = (e: { inicio: string; fin: string | null; todo_el_dia: boolean }): boolean => {
  const [ini, fin] = diasDelEvento(e)
  return e.todo_el_dia || ini !== fin
}

/** Barras de los eventos de varios días en una fila de días (una semana): cada evento UNA sola
 *  barra de su primer a su último día visibles (Edison 2026-10-08: «no repetir la etiqueta en
 *  cada día»), en el primer renglón libre. `sigueAntes`/`sigueDespues`: el evento empieza antes
 *  o termina después de la fila. Pura. */
export function tramos<T extends { inicio: string; fin: string | null; todo_el_dia: boolean }>(
  eventos: T[],
  dias: string[],
): { ev: T; desde: number; hasta: number; renglon: number; sigueAntes: boolean; sigueDespues: boolean }[] {
  if (!dias.length) return []
  const primero = dias[0]
  const ultimo = dias[dias.length - 1]
  const visibles = eventos
    .filter(esDeFranja)
    .map((ev) => {
      const [ini, fin] = diasDelEvento(ev)
      return { ev, ini, fin }
    })
    .filter(({ ini, fin }) => ini <= ultimo && fin >= primero)
    .map(({ ev, ini, fin }) => ({
      ev,
      desde: Math.max(0, dias.indexOf(ini < primero ? primero : ini)),
      hasta: dias.indexOf(fin > ultimo ? ultimo : fin),
      sigueAntes: ini < primero,
      sigueDespues: fin > ultimo,
    }))
    .filter((t) => t.hasta >= t.desde)
    // Primero los que empiezan antes y, a igual inicio, los más largos (arriba, como Google).
    .sort((a, b) => a.desde - b.desde || (b.hasta - b.desde) - (a.hasta - a.desde))
  const finDeRenglon: number[] = []
  return visibles.map((t) => {
    let renglon = finDeRenglon.findIndex((f) => f < t.desde)
    if (renglon === -1) renglon = finDeRenglon.length
    finDeRenglon[renglon] = t.hasta
    return { ...t, renglon }
  })
}

/** Los días AAAA-MM-DD de [desde, hasta], ambos incluidos. */
export function diasEntre(desde: string, hasta: string): string[] {
  const salida: string[] = []
  for (let d = desdeIso(desde); isoDia(d) <= hasta && salida.length < 400; d = sumarDias(d, 1)) salida.push(isoDia(d))
  return salida
}
