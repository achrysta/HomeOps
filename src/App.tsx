import { lazy, type ComponentType } from 'react'
import { AsyncContent } from './components/AsyncContent'
import { Layout } from './components/Layout'
import { ProgressAvailability } from './components/ProgressAvailability'
import { DashboardPage } from './pages/DashboardPage'
import { useRoute, type Page } from './state/router'

const SkillDrawer = lazy(() => import('./components/SkillDrawer').then((m) => ({ default: m.SkillDrawer })))
const TaskDrawer = lazy(() => import('./components/TaskDrawer').then((m) => ({ default: m.TaskDrawer })))

const PAGES: Record<Page, ComponentType> = {
  cheatsheets: lazy(() => import('./pages/CheatsheetsPage').then((m) => ({ default: m.CheatsheetsPage }))),
  diagnostics: lazy(() => import('./pages/DiagnosticsPage').then((m) => ({ default: m.DiagnosticsPage }))),
  dashboard: DashboardPage,
  vacancy: lazy(() => import('./pages/VacancyPage').then((m) => ({ default: m.VacancyPage }))),
  roadmap: lazy(() => import('./pages/RoadmapPage').then((m) => ({ default: m.RoadmapPage }))),
  incidents: lazy(() => import('./pages/IncidentsPage').then((m) => ({ default: m.IncidentsPage }))),
  gyms: lazy(() => import('./pages/GymsPage').then((m) => ({ default: m.GymsPage }))),
  labs: lazy(() => import('./pages/LabsPage').then((m) => ({ default: m.LabsPage }))),
  tests: lazy(() => import('./pages/TestsPage').then((m) => ({ default: m.TestsPage }))),
  quiz: lazy(() => import('./pages/QuizPage').then((m) => ({ default: m.QuizPage }))),
  trainer: lazy(() => import('./pages/TrainerPage').then((m) => ({ default: m.TrainerPage }))),
  interview: lazy(() => import('./pages/InterviewPage').then((m) => ({ default: m.InterviewPage }))),
  resources: lazy(() => import('./pages/ResourcesPage').then((m) => ({ default: m.ResourcesPage }))),
  search: lazy(() => import('./pages/SearchPage').then((m) => ({ default: m.SearchPage }))),
  data: lazy(() => import('./pages/DataPage').then((m) => ({ default: m.DataPage }))),
}

export function App() {
  const route = useRoute()
  const PageComponent = PAGES[route.page]
  const taskId = route.params.get('task')
  const skillId = route.params.get('skill')
  return (
    <ProgressAvailability><Layout page={route.page}>
      <AsyncContent key={route.page}><PageComponent /></AsyncContent>
      {taskId && <AsyncContent key={`task-${taskId}`} label="карточка задачи"><TaskDrawer taskId={taskId} /></AsyncContent>}
      {skillId && <AsyncContent key={`skill-${skillId}`} label="карточка навыка"><SkillDrawer skillId={skillId} /></AsyncContent>}
    </Layout></ProgressAvailability>
  )
}
