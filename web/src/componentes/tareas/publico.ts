/**
 * Lo que la web de Tareas y Agenda ofrece a otros módulos (proyecto Minka; fase 10.2b M4, 2026-10-20): el
 * equivalente web de «tareas.v1» y «agenda.v1». Nadie fuera de Minka importa sus archivos internos; solo esto (lo
 * comprueba backend/tests/test_fronteras.py). Lo usan el chat (crear una tarea o un evento, pegar el resultado de un
 * prompt, abrir lo vinculado), el visor de documentos (agendar sus fechas), la ficha de un contacto, el Inicio («Hoy»)
 * y las fechas próximas. Al extraer Minka, es lo que exporta su paquete web.
 */
export { default as DialogoTarea } from './DialogoTarea'
export { default as DialogoEvento } from './DialogoEvento'
export { default as DialogoPegarTareas } from './DialogoPegarTareas'
export { default as DialogoPegarAgenda } from './DialogoPegarAgenda'
export { default as BotonCrearTarea } from './BotonCrearTarea'
export { default as BotonAgendaDocumento } from './BotonAgendaDocumento'
export { default as PanelHoy } from './PanelHoy'
export { DIAS_CORTOS, MESES_CORTOS, NOMBRE_PREFIJO, PREFIJO_REFERENCIA, desdeIso, diaSemana, isoDia, rutaVinculo, sumarDias } from './calendario'
export type { Feriado, Vinculo } from './tipos'
