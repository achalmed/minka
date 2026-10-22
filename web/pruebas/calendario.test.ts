// Pruebas de las cuentas del calendario de Tareas y Agenda (parte pura). Correr desde frontend/:
//   node --test pruebas/*.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  carriles, cuadriculaMes, desdeIso, diasDeLaSemana, isoDia, posicionEnDia, rutaVinculo, textoPlazo, textoRecurrencia, tituloSemana,
} from '../src/componentes/tareas/calendario.ts'

test('la semana empieza en lunes y el mes muestra 42 días', () => {
  const dias = diasDeLaSemana(desdeIso('2026-10-08')) // jueves
  assert.equal(isoDia(dias[0]), '2026-10-05')
  assert.equal(isoDia(dias[6]), '2026-10-11')
  const mes = cuadriculaMes(desdeIso('2026-10-15'))
  assert.equal(mes.length, 42)
  assert.equal(isoDia(mes[0]), '2026-09-28')
  assert.equal(tituloSemana(desdeIso('2026-10-08')), '5 – 11 de octubre de 2026')
})

test('posición de un evento en la columna del día', () => {
  const p = posicionEnDia('2026-10-07T15:00:00', '2026-10-07T17:00:00', '2026-10-07', 7, 22)
  assert.deepEqual(p, { desde: 8 * 60, alto: 120 })
  // Sin fin: una hora. Antes de la franja: arriba.
  assert.deepEqual(posicionEnDia('2026-10-07T05:30:00', null, '2026-10-07', 7, 22), { desde: 0, alto: 20 })
  // Empezó el día anterior: desde arriba.
  assert.equal(posicionEnDia('2026-10-06T23:00:00', '2026-10-07T09:00:00', '2026-10-07', 7, 22).desde, 0)
})

test('carriles de los que se superponen', () => {
  const r = carriles([
    { inicio: '2026-10-07T15:00:00', fin: '2026-10-07T17:00:00', t: 'a' },
    { inicio: '2026-10-07T15:00:00', fin: '2026-10-07T18:00:00', t: 'b' },
    { inicio: '2026-10-07T17:00:00', fin: '2026-10-07T19:00:00', t: 'c' },
    { inicio: '2026-10-07T20:00:00', fin: null, t: 'd' },
  ])
  const por = Object.fromEntries(r.map((x) => [x.ev.t, x]))
  assert.equal(por.a.de, 2)
  assert.notEqual(por.a.carril, por.b.carril)
  assert.equal(por.c.carril, por.a.carril) // reutiliza el carril que dejó libre «a»
  assert.equal(por.d.de, 1)
  assert.equal(por.a.ancho, 1) // «b» ocupa el carril de al lado a la misma hora
})

test('un bloque se extiende por los carriles libres de su derecha', () => {
  const r = carriles([
    { inicio: '2026-10-19T09:00:00', fin: '2026-10-19T10:00:00', t: 'p' },
    { inicio: '2026-10-19T09:00:00', fin: '2026-10-19T10:00:00', t: 'q' },
    { inicio: '2026-10-19T09:30:00', fin: '2026-10-19T12:00:00', t: 'largo' },
    { inicio: '2026-10-19T10:30:00', fin: '2026-10-19T11:00:00', t: 'r' },
  ])
  const por = Object.fromEntries(r.map((x) => [x.ev.t, x]))
  assert.equal(por.r.de, 3)
  assert.equal(por.r.carril, 0) // «p» ya terminó: su carril queda libre
  assert.equal(por.r.ancho, 2) // y también el de «q»; el de «largo» no
  assert.equal(por.largo.ancho, 1)
})

test('texto del plazo', () => {
  assert.equal(textoPlazo('2026-10-06', '15:00', '2026-10-06'), 'Hoy 15:00')
  assert.equal(textoPlazo('2026-10-07', null, '2026-10-06'), 'Mañana')
  assert.equal(textoPlazo('2026-10-05', null, '2026-10-06'), 'Ayer')
  assert.equal(textoPlazo('2026-10-09', null, '2026-10-06'), 'vie 9 oct')
  assert.equal(textoPlazo('2026-12-25', null, '2026-10-06'), '25 dic')
  assert.equal(textoPlazo('2027-01-02', null, '2026-10-06'), '2 ene 2027')
  assert.equal(textoPlazo(null, null, '2026-10-06'), '')
})

test('rutas de los vínculos y recurrencia en palabras', () => {
  assert.equal(rutaVinculo('doc:12'), '/documentos/12')
  assert.equal(rutaVinculo('pl:3'), '/proyectos/3')
  assert.equal(rutaVinculo('sr:2'), '/informes/2')
  assert.equal(rutaVinculo('entrada:5'), '/recibidos?ver=5')
  assert.equal(rutaVinculo('persona:7'), '/directorio?contacto=7')
  assert.equal(rutaVinculo('inst:4'), '/directorio?pestana=instituciones&ver=4')
  assert.equal(rutaVinculo('norma:x'), null)
  assert.equal(textoRecurrencia({ frecuencia: 'semanal', dias: [1, 2], hasta: '2026-12-15' }), 'cada semana: mar, mié · hasta el 15/12')
  assert.equal(textoRecurrencia({ frecuencia: 'diaria' }), 'todos los días')
  assert.equal(textoRecurrencia({ frecuencia: 'semanal', intervalo: 2, dias: [5] }), 'cada 2 semanas: sáb')
})
