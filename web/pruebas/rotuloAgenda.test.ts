// Pruebas de los títulos uniformes de la agenda (2026-10-19). Correr desde frontend/:  node --test pruebas/*.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gritado, tituloAgenda } from '../src/componentes/tareas/rotuloAgenda.ts'

test('un título gritado pasa a forma de título, con nexos en minúscula y siglas intactas', () => {
  assert.equal(
    tituloAgenda('FORO “AVANCES Y DESAFÍOS DE LA FORMALIZACIÓN MINERA ARTESANAL EN EL PERÚ”'),
    'Foro “Avances y Desafíos de la Formalización Minera Artesanal en el Perú”',
  )
  assert.equal(tituloAgenda('REUNIÓN CON LA DREA Y EL MINEDU'), 'Reunión con la DREA y el MINEDU')
  assert.equal(tituloAgenda('XII SESIÓN ORDINARIA (PL 1234-2026)'), 'XII Sesión Ordinaria (PL 1234-2026)')
  assert.ok(gritado('SESIÓN DE COMISIÓN') && !gritado('Sesión de Comisión') && !gritado('OK'))
})

test('todo en minúsculas también se uniforma; lo mixto solo recibe la inicial', () => {
  assert.equal(tituloAgenda('reunión con el alcalde de huanta'), 'Reunión con el Alcalde de Huanta')
  assert.equal(tituloAgenda('reunión con Minedu sobre Juegos escolares DREA'), 'Reunión con Minedu sobre Juegos escolares DREA')
  assert.equal(tituloAgenda('  Décima  Segunda Sesión '), 'Décima Segunda Sesión')
  assert.equal(tituloAgenda(''), '')
})
