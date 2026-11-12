import { BookOpen, BookOpenText, ClipboardCheck, Dumbbell, List, MessagesSquare, PencilRuler, Siren, Table2, Timer, type LucideIcon } from 'lucide-react'
import { buildHash, type Page } from '../state/router'

/** Вкладки раздела меню: каждая — своя страница (или режим страницы через params), пункт меню один. */
function PageTabs<T extends string>({ active, tabs }: { active: T; tabs: { id: T; page: Page; params?: Record<string, string>; label: string; icon: LucideIcon }[] }) {
  return (
    <div className="inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-surface-2 p-1">
      {tabs.map(({ id, page, params, label, icon: Icon }) => (
        <a
          key={id}
          href={buildHash(page, params)}
          aria-current={active === id ? 'page' : undefined}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${active === id ? 'bg-surface font-medium text-accent shadow-card' : 'text-muted hover:text-fg'}`}
        >
          <Icon size={13} /> {label}
        </a>
      ))}
    </div>
  )
}

/** «Дорожная карта»: по трекам, общей таблицей и контрольные тесты. */
export function RoadmapTabs({ active }: { active: 'roadmap' | 'labs' | 'tests' }) {
  return (
    <PageTabs
      active={active}
      tabs={[
        { id: 'roadmap', page: 'roadmap', label: 'По трекам', icon: List },
        { id: 'labs', page: 'labs', label: 'Таблица', icon: Table2 },
        { id: 'tests', page: 'tests', label: 'Тесты', icon: ClipboardCheck },
      ]}
    />
  )
}

/** «Материалы»: ссылки на чтение и конспекты со шпаргалками. */
export function MaterialsTabs({ active }: { active: 'resources' | 'cheatsheets' }) {
  return (
    <PageTabs
      active={active}
      tabs={[
        { id: 'resources', page: 'resources', label: 'Материалы', icon: BookOpen },
        { id: 'cheatsheets', page: 'cheatsheets', label: 'Конспекты и шпаргалки', icon: BookOpenText },
      ]}
    />
  )
}

/** «Стенды»: инциденты и залы. */
export function StandsTabs({ active }: { active: 'incidents' | 'gyms' }) {
  return (
    <PageTabs
      active={active}
      tabs={[
        { id: 'incidents', page: 'incidents', label: 'Инциденты', icon: Siren },
        { id: 'gyms', page: 'gyms', label: 'Залы', icon: Timer },
      ]}
    />
  )
}

/** «Тренажёр»: вопросы и упражнения, ответы вслух со сверкой по тезисам, кейсы проектирования. */
export function TrainerTabs({ active }: { active: 'trainer' | 'explain' | 'design' }) {
  return (
    <PageTabs
      active={active}
      tabs={[
        { id: 'trainer', page: 'trainer', label: 'Тренажёр', icon: Dumbbell },
        { id: 'explain', page: 'interview', params: { view: 'topics' }, label: 'Своими словами', icon: MessagesSquare },
        { id: 'design', page: 'interview', params: { view: 'design' }, label: 'Проектирование', icon: PencilRuler },
      ]}
    />
  )
}
