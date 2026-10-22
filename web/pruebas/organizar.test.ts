// Pruebas de cómo se ordena Tareas y Agenda (2026-10-18): clase del tablero, «Mis tareas» y la
// línea de autoría de un evento. Correr desde frontend/:  node --test pruebas/*.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  contarClases, esPrioritaria, filtrarClase, gruposPendientes, lineaAutoria, ordenColumna, resumenMias, separarTramite, textoCruces, tituloCorto,
} from '../src/componentes/tareas/organizar.ts'
import type { Tarea } from '../src/componentes/tareas/tipos.ts'

const t = (id: number, cambios: Partial<Tarea> = {}): Tarea => ({
  id, titulo: `T${id}`, descripcion: '', estado: 'por_hacer', prioridad: 'normal', responsable_id: 1, responsable: 'Ana',
  vence_en: null, vence_fecha: null, vence_hora: null, con_hora: false, vencida: false, lista_id: null, lista: '', lista_color: '',
  orden: id, etiquetas: [], checklist: [], plantilla: '', entregable: '', entregable_texto: '', vinculos: [], origen: 'qillqa',
  version: 1, creado_por: 1, creado_por_nombre: 'Ana', creado_en: null, cerrada_en: null, clase: 'interna', ...cambios,
})

test('el tablero filtra por clase y deja las automáticas al final', () => {
  const ts = [t(1, { origen: 'automatica', orden: 0 }), t(2, { clase: 'externa', orden: 5 }), t(3, { orden: 9 })]
  assert.deepEqual(filtrarClase(ts, 'externa').map((x) => x.id), [2])
  assert.deepEqual(filtrarClase(ts, 'todas').map((x) => x.id), [1, 2, 3])
  assert.deepEqual(contarClases(ts), { todas: 3, interna: 2, externa: 1 })
  // La automática tiene el orden más bajo, pero va después de las escritas a mano.
  assert.deepEqual(ordenColumna(ts).map((x) => x.id), [2, 3, 1])
})

test('«Mis tareas»: cuatro grupos, lo prioritario primero, y las cuentas', () => {
  const hoy = '2026-10-18'
  const ts = [
    t(1, { vencida: true, vence_fecha: '2026-10-15' }),
    t(2, { vence_fecha: hoy }),
    t(3, { vence_fecha: hoy, prioridad: 'urgente' }),
    t(4, { vence_fecha: '2026-11-02' }),
    t(5),
    t(6, { estado: 'hecha', cerrada_en: '2026-10-17T10:00:00-05:00' }),
    t(7, { importante: true }),
  ]
  const g = gruposPendientes(ts, hoy)
  assert.deepEqual(g.map((x) => x.titulo), ['Vencidas', 'Hoy', 'Próximas', 'Sin fecha'])
  assert.deepEqual(g[1].tareas.map((x) => x.id), [3, 2])
  assert.deepEqual(g[3].tareas.map((x) => x.id), [7, 5])
  assert.deepEqual(resumenMias(ts), { pendientes: 6, prioritarias: 2, hechas: 1 })
  assert.equal(esPrioritaria(t(9, { prioridad: 'alta' })), true)
  // Una automática nace importante: solo es prioritaria si además apremia.
  assert.equal(esPrioritaria(t(10, { origen: 'automatica', importante: true, cuadrante: 'planificar' })), false)
  assert.equal(esPrioritaria(t(11, { origen: 'automatica', importante: true, cuadrante: 'hacer' })), true)
})

test('la línea de autoría de un evento', () => {
  const base = { creado_por: 1, creado_por_nombre: 'Ana', actualizado_por: 1, actualizado_por_nombre: 'Ana', origen: 'qillqa', version: 1 }
  assert.equal(lineaAutoria(base), 'Creada por Ana')
  assert.equal(lineaAutoria({ ...base, version: 3 }), 'Creada por Ana')
  assert.equal(lineaAutoria({ ...base, version: 2, actualizado_por: 4, actualizado_por_nombre: 'Luis' }), 'Creada por Ana · editada por Luis')
  assert.equal(lineaAutoria({ ...base, origen: 'detectado', creado_por: null, creado_por_nombre: '', actualizado_por: 4, actualizado_por_nombre: 'Luis', version: 2 }),
    'Detectada en un documento · editada por Luis')
  assert.equal(lineaAutoria({ ...base, creado_por: null, creado_por_nombre: '', actualizado_por: null, actualizado_por_nombre: '' }), '')
})

test('las tareas del trámite se leen cortas y se agrupan por paso', () => {
  assert.deepEqual(tituloCorto('Registrar en el STD Oficio N°0156-2026-2027-ABC-CD/CRP · Evaluación urgente de riesgos'), { paso: 'Registrar en el STD', documento: 'Oficio N° 0156', asunto: 'Evaluación urgente de riesgos' })
  assert.deepEqual(tituloCorto('Subir el cargo de recepción de Oficio S/N-2026-2027-ABC-CD/CRP · Prueba'), { paso: 'Subir el cargo de recepción', documento: 'Oficio S/N', asunto: 'Prueba' })
  assert.deepEqual(tituloCorto('Llamar a la UGEL'), { paso: '', documento: '', asunto: 'Llamar a la UGEL' })
  const ts = [
    t(1, { origen: 'automatica', titulo: 'Registrar en el STD Oficio N°0001-2026 · A' }),
    t(2, { origen: 'automatica', titulo: 'Firmar y subir el firmado de Oficio N°0002-2026 · B' }),
    t(3, { titulo: 'Llamar a la UGEL' }),
    t(4, { origen: 'automatica', titulo: 'Agendar: invitación' }),
  ]
  const { propias, tramite } = separarTramite(ts)
  assert.deepEqual(propias.map((x) => x.id), [3, 4])
  assert.deepEqual(tramite.map((g) => [g.paso, g.tareas.length]), [['Firmar y subir el firmado', 1], ['Registrar en el STD', 1]])
  assert.equal(textoCruces(0), '')
  assert.equal(textoCruces(1), '1 cruce de horario')
  assert.equal(textoCruces(4), '4 cruces de horario')
})
