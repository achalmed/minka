/**
 * El módulo web de Tareas y Agenda (proyecto Minka; fase 10.2b M4 del contrato de Tiqsi, 2026-10-20): sus pantallas,
 * sus rutas y cómo entra al menú del anfitrión. Qillqa arma con esto su entrada en el menú (navegacion.ts) y sus
 * rutas (App.tsx); la página de Tareas y Agenda SOLA (src/minka_sola.tsx), su cáscara mínima.
 *
 * Encargos con responsable, plazo y estado (lista, tablero, matriz y «Hoy»; alta rápida en lenguaje natural) y la
 * agenda del despacho con choques de horario. OpenProject queda como espejo opcional.
 */
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined'
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined'
import TodayOutlinedIcon from '@mui/icons-material/TodayOutlined'
import ViewKanbanOutlinedIcon from '@mui/icons-material/ViewKanbanOutlined'
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined'
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import AddTaskOutlinedIcon from '@mui/icons-material/AddTaskOutlined'
import { definirModuloWeb } from '@qillqa/tiqsi'

export const MINKA = definirModuloWeb({
  id: 'tareas',
  nombre: 'Tareas y Agenda',
  corto: 'Tareas',
  ruta: '/tareas',
  icono: TaskAltOutlinedIcon,
  descripcion: 'Encargos con responsable, plazo y estado; agenda del despacho con choques de horario.',
  opciones: [
    { etiqueta: 'Mis tareas', ruta: '/tareas', icono: ChecklistOutlinedIcon, ayuda: 'Lo que tiene a su cargo, por plazo' },
    { etiqueta: 'Hoy', ruta: '/tareas?ver=hoy', icono: TodayOutlinedIcon, ayuda: 'La agenda de hoy y sus tareas de hoy y vencidas' },
    { etiqueta: 'Tablero', ruta: '/tareas?ver=tablero', icono: ViewKanbanOutlinedIcon, ayuda: 'Todas las tareas por estado; arrastrar para moverlas' },
    { etiqueta: 'Matriz', ruta: '/tareas?ver=matriz', icono: GridViewOutlinedIcon, ayuda: 'Urgente e importante: cada tarea se ordena sola por su plazo e importancia' },
    { etiqueta: 'Agenda', ruta: '/agenda', icono: CalendarMonthOutlinedIcon, ayuda: 'Calendario del despacho: mes, semana y día' },
    { etiqueta: 'Todas', ruta: '/tareas?ver=todas', icono: FormatListBulletedIcon, ayuda: 'Las del equipo, con filtros' },
    { etiqueta: 'Nueva tarea', ruta: '/tareas?nueva=1', icono: AddTaskOutlinedIcon, accion: true, ayuda: 'A mano o desde el resultado del prompt de plan de tareas' },
  ],
  cargar: () => import('../../paginas/Tareas'),
  pantallas: [
    // La agenda: mes, semana, tres días y día, con lo por confirmar y los choques.
    { ruta: '/agenda', cargar: () => import('../../paginas/Agenda') },
  ],
})
