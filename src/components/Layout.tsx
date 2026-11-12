import {
  BookOpen,
  Database,
  Download,
  Dumbbell,
  LayoutDashboard,
  Map as MapIcon,
  Menu,
  Moon,
  Search,
  Siren,
  Sun,
  Target,
  type LucideIcon,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { pct, targetName, toneForPct } from '../lib/labels'
import { buildExport, downloadJSON, THEME_KEY, todayLocal } from '../lib/storage'
import { todayReviews } from '../lib/today'
import { useStore } from '../state/context'
import { buildHash, navigate, useRoute, type Page } from '../state/router'
import { useNow } from '../state/useNow'
import { SyncIndicator } from './SyncIndicator'
import { ProgressNotice } from './ProgressAvailability'
import { ProgressBar } from './ui'
import { AsyncContent } from './AsyncContent'

const OnboardingTour = lazy(() => import('./OnboardingTour').then((m) => ({ default: m.OnboardingTour })))
const CkaExamDeadline = lazy(() => import('./CkaExamDeadline').then((m) => ({ default: m.CkaExamDeadline })))

interface NavItem {
  page: Page
  label: string
  icon: LucideIcon
  /** Параметры ссылки (например, вкладка раздела) */
  params?: Record<string, string>
  /** Когда пункт подсвечен; по умолчанию — на своей странице */
  active?: (page: Page, params: URLSearchParams) => boolean
  /** Счётчик справа: сколько пора повторить (сумма по перечисленным видам) */
  badge?: ('practice' | 'interview' | 'gyms')[]
}

/** Меню по сценариям: учиться → практиковаться → смотреть прогресс. Режимы разделов — вкладки на страницах. */
const NAV: { title?: string; items: NavItem[] }[] = [
  {
    items: [{ page: 'dashboard', label: 'Сегодня', icon: LayoutDashboard }],
  },
  {
    title: 'Учиться',
    items: [
      // вкладки: карта, таблица задач, контрольные тесты (из них — входная диагностика)
      { page: 'roadmap', label: 'Дорожная карта', icon: MapIcon, active: (page) => ['roadmap', 'labs', 'tests', 'quiz', 'diagnostics'].includes(page) },
      { page: 'resources', label: 'Материалы', icon: BookOpen, active: (page) => page === 'resources' || page === 'cheatsheets' },
    ],
  },
  {
    title: 'Практика',
    items: [
      { page: 'incidents', label: 'Стенды', icon: Siren, active: (page) => page === 'incidents' || page === 'gyms', badge: ['gyms'] },
      // вкладки: тренажёр, «Своими словами», проектирование
      { page: 'trainer', label: 'Тренажёр', icon: Dumbbell, active: (page) => page === 'trainer' || page === 'interview', badge: ['practice', 'interview'] },
    ],
  },
  {
    title: 'Прогресс',
    items: [
      { page: 'vacancy', label: 'Навыки', icon: Target },
      { page: 'data', label: 'Резервная копия', icon: Database },
    ],
  },
]

function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
    } catch {
      // ignore
    }
  }, [dark])
  return [dark, () => setDark((d) => !d)]
}

export function Layout({ page, children }: { page: Page; children: ReactNode }) {
  const { curriculum, progress, vacancy, match, learning, saveError } = useStore()
  const { params } = useRoute()
  const now = useNow()
  const due = todayReviews(curriculum, progress, now)
  const [dark, toggleTheme] = useTheme()
  const [navOpen, setNavOpen] = useState(false)
  const [q, setQ] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const exportNow = () =>
    downloadJSON(`homeops-progress-${todayLocal()}.json`, buildExport(progress, curriculum))

  return (
    <div className="min-h-screen bg-bg text-fg">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-bg transition-transform lg:translate-x-0 ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="px-5 pt-5 pb-4">
          <div className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">Цель обучения</div>
          <div className="mt-1 truncate text-sm font-semibold text-fg" title={targetName(vacancy)}>
            {targetName(vacancy)}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <MiniMetric label="Навыки" title="Покрытие профиля навыками" value={match.overall} />
            <MiniMetric label="Обучение" title="Прогресс обучения" value={learning.pct} tone="accent" />
          </div>
        </div>
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4">
          {NAV.map((group, gi) => (
            <div key={gi} className={gi > 0 ? 'mt-5' : ''}>
              {group.title && <div className="mb-1.5 px-3 text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">{group.title}</div>}
              {group.items.map(({ page: p, label, icon: Icon, params: itemParams, active: isActive, badge }) => {
                const active = isActive ? isActive(page, params) : page === p
                const count = badge ? badge.reduce((n, b) => n + due[b], 0) : 0
                return (
                  <a
                    key={label}
                    href={buildHash(p, itemParams)}
                    onClick={() => setNavOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={`mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                      active ? 'bg-surface font-medium text-fg shadow-card' : 'text-muted hover:bg-surface/60 hover:text-fg'
                    }`}
                  >
                    <Icon size={17} className={active ? 'text-accent' : ''} />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {count > 0 && (
                      <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] leading-none font-semibold text-warn tabular-nums" title="Пора повторить">
                        {count}
                      </span>
                    )}
                  </a>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="space-y-1 border-t border-line px-5 py-3 text-[12px] text-subtle">
          <SyncIndicator />
          <div>Программа {curriculum.version}</div>
        </div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setNavOpen(false)} aria-hidden />}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line/60 bg-bg/85 px-4 py-3 backdrop-blur sm:px-6 lg:px-10">
          <button type="button" className="rounded p-1.5 text-muted hover:bg-surface-2 lg:hidden" onClick={() => setNavOpen(true)} aria-label="Меню">
            <Menu size={18} />
          </button>
          <form
            className="relative min-w-0 max-w-xl flex-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (q.trim()) navigate('search', { q: q.trim() })
            }}
          >
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="field pl-8"
              placeholder="Поиск по навыкам, задачам, материалам, заметкам…"
              aria-label="Поиск"
            />
            <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-line px-1.5 font-mono text-[10px] text-subtle sm:block">/</kbd>
          </form>
          <div className="ml-auto flex items-center gap-1">
            <AsyncContent label="краткий тур"><OnboardingTour /></AsyncContent>
            {saveError && <span className="mr-2 text-xs text-warn">Кэш браузера недоступен</span>}
            <button type="button" onClick={exportNow} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-fg" title="Экспорт резервной копии в JSON">
              <Download size={14} /> <span className="hidden sm:inline">Экспорт</span>
            </button>
            <button type="button" onClick={toggleTheme} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Переключить тему" title="Переключить тему">
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          <ProgressNotice />
          {progress.ckaExams?.some((a) => a.phase === 'running') && <Suspense fallback={null}><CkaExamDeadline /></Suspense>}
          {children}
        </main>
      </div>
    </div>
  )
}

function MiniMetric({ label, title, value, tone }: { label: string; title: string; value: number; tone?: 'accent' }) {
  const t = tone ?? toneForPct(value)
  return (
    <div title={`${title}: ${pct(value)}`}>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-muted">{label}</span>
        <span className="font-semibold text-fg tabular-nums">{pct(value)}</span>
      </div>
      <ProgressBar value={value} tone={t} size="sm" />
    </div>
  )
}
