import { useSyncExternalStore } from 'react'

export type Page =
  | 'dashboard'
  | 'vacancy'
  | 'roadmap'
  | 'incidents'
  | 'gyms'
  | 'labs'
  | 'tests'
  | 'quiz'
  | 'trainer'
  | 'interview'
  | 'resources'
  | 'search'
  | 'data'
  | 'cheatsheets'
  | 'diagnostics'

const PAGES: Page[] = ['dashboard', 'vacancy', 'roadmap', 'incidents', 'gyms', 'labs', 'tests', 'quiz', 'trainer', 'interview', 'resources', 'search', 'data', 'cheatsheets', 'diagnostics']

export interface Route {
  page: Page
  params: URLSearchParams
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const [path, query = ''] = raw.split('?')
  const page = PAGES.includes(path as Page) ? (path as Page) : 'dashboard'
  return { page, params: new URLSearchParams(query) }
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

const getHash = () => window.location.hash

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, () => '')
  return parse(hash)
}

export function buildHash(page: Page, params?: Record<string, string | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) if (v) qs.set(k, v)
  const s = qs.toString()
  return `#/${page}${s ? `?${s}` : ''}`
}

export function navigate(page: Page, params?: Record<string, string | undefined>): void {
  window.location.hash = buildHash(page, params)
}

/** Открыть/закрыть карточку задачи поверх текущей страницы, сохранив остальные параметры. */
export function setTaskParam(taskId: string | null): void {
  const { page, params } = parse(window.location.hash)
  const obj = Object.fromEntries(params.entries())
  if (taskId) obj.task = taskId
  else delete obj.task
  // карточки задачи и навыка не открываются одновременно
  if (taskId) delete obj.skill
  navigate(page, obj)
}

/** Открыть/закрыть карточку навыка поверх текущей страницы (карточка задачи при этом закрывается). */
export function setSkillParam(skillId: string | null): void {
  const { page, params } = parse(window.location.hash)
  const obj = Object.fromEntries(params.entries())
  if (skillId) {
    obj.skill = skillId
    delete obj.task
  } else delete obj.skill
  navigate(page, obj)
}

/** Заменить текущий route без новой записи в history (для live-поиска). */
export function replaceRoute(page: Page, params?: Record<string, string | undefined>): void {
  window.history.replaceState(null, '', buildHash(page, params))
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}
