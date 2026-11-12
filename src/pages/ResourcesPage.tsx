import { Info, SearchX } from 'lucide-react'
import { ResourceItem } from '../components/ResourceItem'
import { Card, EmptyState, PageHeader } from '../components/ui'
import { RESOURCE_TYPE_LABEL } from '../lib/labels'
import { useStore } from '../state/context'
import { setTaskParam } from '../state/router'
import { useLocalState } from '../state/useLocalState'
import type { Resource, ResourceType } from '../types'
import { isSaved } from '../lib/practice'
import { MaterialsTabs } from '../components/SectionTabs'

interface ResourceFilters {
  track: string
  type: ResourceType | ''
  done: '' | 'done' | 'todo' | 'saved'
  lang: '' | 'ru' | 'en'
  query: string
}

const EMPTY: ResourceFilters = { track: '', type: '', done: '', lang: '', query: '' }
const isRussian = (r: Resource) => r.language === 'ru' || !!r.ru

export function ResourcesPage() {
  const { curriculum, progress } = useStore()
  const [f, setF] = useLocalState<ResourceFilters>('resources.filters', EMPTY)

  // ресурс → задачи и tracks, где он используется
  const usage = new Map<string, { tasks: string[]; tracks: Set<string> }>()
  for (const t of curriculum.tasks) {
    for (const rid of t.resourceIds) {
      const u = usage.get(rid) ?? { tasks: [], tracks: new Set<string>() }
      u.tasks.push(t.id)
      u.tracks.add(t.trackId)
      usage.set(rid, u)
    }
  }

  const q = f.query.trim().toLowerCase()
  const list = curriculum.resources.filter((r) => {
    const done = !!progress.resources[r.id]?.completed
    if (f.type && r.type !== f.type) return false
    if (f.done === 'done' && !done) return false
    if (f.done === 'todo' && done) return false
    if (f.done === 'saved' && !isSaved(progress.saved, 'resource', r.id)) return false
    if (f.lang === 'ru' && !isRussian(r)) return false
    if (f.lang === 'en' && isRussian(r)) return false
    if (f.track && !usage.get(r.id)?.tracks.has(f.track)) return false
    if (q && !`${r.title} ${r.ru?.title ?? ''} ${r.url} ${r.note ?? ''}`.toLowerCase().includes(q)) return false
    return true
  })
  // в каждой группе сначала материалы на русском
  list.sort((a, b) => Number(isRussian(b)) - Number(isRussian(a)))
  const ruCount = curriculum.resources.filter(isRussian).length
  const doneCount = curriculum.resources.filter((r) => progress.resources[r.id]?.completed).length

  // группировка по первому track, где используется ресурс
  const groups = curriculum.tracks
    .map((track) => ({
      track,
      items: list.filter((r) => {
        const tracks = usage.get(r.id)?.tracks
        if (!tracks) return false
        const first = curriculum.tracks.find((t) => tracks.has(t.id))
        return f.track ? true : first?.id === track.id
      }),
    }))
    .filter((g) => (f.track ? g.track.id === f.track : true) && g.items.length > 0)
  const orphan = list.filter((r) => !usage.has(r.id))

  return (
    <div>
      <PageHeader eyebrow="Учиться" title="Материалы" actions={<MaterialsTabs active="resources" />} description={`Сначала материалы на русском, англоязычная документация — справочник. На русском: ${ruCount} из ${curriculum.resources.length}. Изучено: ${doneCount}.`} />

      <div className="mb-4 flex items-start gap-2 rounded-xl bg-surface px-4 py-3 text-xs text-muted shadow-card">
        <Info size={14} className="mt-0.5 shrink-0 text-info" />
        Отметка «изучено» нужна для личного учёта и не влияет ни на прогресс обучения, ни на навыки.
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl bg-surface p-3 shadow-card">
        <input className="field max-w-xs py-1 text-xs" placeholder="Поиск по названию / URL" value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })} />
        <select className="field w-auto max-w-full py-1 text-xs" value={f.track} onChange={(e) => setF({ ...f, track: e.target.value })} aria-label="Трек">
          <option value="">Все треки</option>
          {curriculum.tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code} · {t.title}
            </option>
          ))}
        </select>
        <select className="field w-auto py-1 text-xs" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as ResourceType | '' })} aria-label="Тип">
          <option value="">Все типы</option>
          {(Object.keys(RESOURCE_TYPE_LABEL) as ResourceType[]).map((t) => (
            <option key={t} value={t}>
              {RESOURCE_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select className="field w-auto py-1 text-xs" value={f.done} onChange={(e) => setF({ ...f, done: e.target.value as ResourceFilters['done'] })} aria-label="Статус">
          <option value="">Все</option>
          <option value="todo">Не изучено</option>
          <option value="done">Изучено</option>
          <option value="saved">Сохранённые</option>
        </select>
        <select className="field w-auto py-1 text-xs" value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value as ResourceFilters['lang'] })} aria-label="Язык">
          <option value="">Любой язык</option>
          <option value="ru">Есть на русском</option>
          <option value="en">Только на английском</option>
        </select>
        <span className="ml-auto text-xs text-subtle">{list.length} материалов</span>
      </div>

      {list.length === 0 && <EmptyState icon={<SearchX size={22} />} title="Ничего не найдено" />}

      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map(({ track, items }) => (
          <Card key={track.id} title={`${track.code} · ${track.title}`} subtitle={`${items.length} материалов`}>
            <div className="-mx-2">
              {items.map((r) => (
                <ResourceItem key={r.id} resource={r}>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {usage.get(r.id)?.tasks.map((id) => (
                      <button key={id} type="button" onClick={() => setTaskParam(id)} className="rounded-md bg-surface-2 px-1.5 font-mono text-[11px] text-subtle hover:text-accent">
                        {id}
                      </button>
                    ))}
                  </div>
                </ResourceItem>
              ))}
            </div>
          </Card>
        ))}
        {orphan.length > 0 && (
          <Card title="Прочее">
            <div className="-mx-2">
              {orphan.map((r) => (
                <ResourceItem key={r.id} resource={r} />
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
