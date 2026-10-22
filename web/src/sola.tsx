/**
 * Tareas y Agenda SOLA en el navegador (Minka): la cáscara mínima de Tiqsi con el módulo web de Tareas y Agenda, contra el
 * anfitrión mínimo del backend (minka/sola.py). No importa nada de Qillqa. Se construye desde la raíz con
 * `npm run web:construir`.
 */
import { createRoot } from 'react-dom/client'
import { CascaronMinimo } from '@qillqa/tiqsi/minimo'
import { MINKA } from './componentes/tareas/modulo'

createRoot(document.getElementById('root')!).render(<CascaronMinimo modulo={MINKA} />)
