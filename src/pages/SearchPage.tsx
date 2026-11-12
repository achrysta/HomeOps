import { ExternalLink, Search, SearchX } from 'lucide-react'
import type { ReactNode } from 'react'
import { ImportanceBadge } from '../components/badges'
import { TaskRow } from '../components/TaskRow'
import { Badge, Card, EmptyState, PageHeader } from '../components/ui'
import { RESOURCE_TYPE_LABEL } from '../lib/labels'
import { search, type NoteHit, type ProgramHit } from '../lib/search'
import { useStore } from '../state/context'
import { buildHash, navigate, replaceRoute, setSkillParam, setTaskParam, useRoute } from '../state/router'

const NOTE_KIND_LABEL: Record<NoteHit['kind'], string> = {
  'task-note': 'Заметка к задаче',
  evidence: 'Подтверждение',
  interview: 'Своими словами',
  design: 'Проектирование',
  'skill-note': 'Самооценка',
}

const PROGRAM_KIND_LABEL: Record<ProgramHit['kind'], string> = { incident: 'Инцидент', gym: 'Зал', question: 'Вопрос «Своими словами»' }

export function SearchPage() {
  const { curriculum, progress, vacancy, match } = useStore()
  const route = useRoute()
  const q = route.params.get('q') ?? ''
  const r = search(q, curriculum, progress)

  const openNote = (n: NoteHit) => {
    if (n.taskId) setTaskParam(n.taskId)
    else if (n.topicId) navigate('interview')
    else if (n.designId) navigate('interview', { view: 'design', case: n.designId })
    else if (n.skillId) setSkillParam(n.skillId)
  }

  return (
    <div>
      <PageHeader title="Поиск" description="Навыки, задачи, материалы, инциденты, залы, вопросы «Своими словами» и ваши заметки." />
      <div className="relative mb-6 max-w-2xl">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle" />
        <input
          autoFocus
          className="field py-2.5 pl-9 text-base"
          placeholder="Например: KV cache, recall, canary, pgvector…"
          value={q}
          onChange={(e) => replaceRoute('search', { q: e.target.value })}
        />
      </div>

      {q.trim().length < 2 ? (
        <EmptyState icon={<Search size={28} />} title="Введите минимум 2 символа" />
      ) : r.total === 0 ? (
        <EmptyState icon={<SearchX size={22} />} title={`Ничего не найдено по «${q}»`} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {r.tasks.length > 0 && (
            <Section title="Задачи и лабораторные" count={r.tasks.length} wide>
              <div className="-mx-3">
                {r.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} showTrack />
                ))}
              </div>
            </Section>
          )}
          {r.skills.length > 0 && (
            <Section title="Навыки" count={r.skills.length}>
              <ul className="space-y-2">
                {r.skills.map((s) => {
                  const row = match.rows.find((x) => x.skill.id === s.id)
                  const req = vacancy.requirements.find((x) => x.skillId === s.id)
                  return (
                    <li key={s.id}>
                      <a href={buildHash('search', { q, skill: s.id })} className="flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-surface-2">
                        <span>
                          <span className="text-sm text-fg">{s.title}</span>
                          <span className="block text-xs text-muted">{s.description}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {req && <ImportanceBadge importance={req.importance} />}
                          {row && (
                            <span className="font-mono text-xs text-muted">
                              {row.current}/{row.target}
                            </span>
                          )}
                        </span>
                      </a>
                    </li>
                  )
                })}
              </ul>
            </Section>
          )}
          {r.resources.length > 0 && (
            <Section title="Материалы" count={r.resources.length}>
              <ul className="space-y-1">
                {r.resources.map((res) => (
                  <li key={res.id}>
                    <a href={res.ru?.url ?? res.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-fg hover:bg-surface-2 hover:text-accent">
                      <Badge>{RESOURCE_TYPE_LABEL[res.type]}</Badge>
                      <span className="truncate">{res.ru?.title ?? res.title}</span>
                      <ExternalLink size={12} className="shrink-0 text-subtle" />
                    </a>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {r.program.length > 0 && (
            <Section title="Практика и вопросы" count={r.program.length}>
              <ul className="space-y-2">
                {r.program.map((h) => (
                  <li key={`${h.kind}-${h.page}-${Object.values(h.params).join('-')}`}>
                    <button type="button" onClick={() => navigate(h.page, h.params)} className="w-full rounded px-2 py-1.5 text-left hover:bg-surface-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge tone="info">{PROGRAM_KIND_LABEL[h.kind]}</Badge>
                        <span className="min-w-0 flex-1 basis-44 line-clamp-2 text-sm text-fg sm:line-clamp-none sm:truncate">{h.title}</span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-muted">{h.snippet}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {r.notes.length > 0 && (
            <Section title="Заметки" count={r.notes.length}>
              <ul className="space-y-2">
                {r.notes.map((n, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => openNote(n)} className="w-full rounded px-2 py-1.5 text-left hover:bg-surface-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge tone="accent">{NOTE_KIND_LABEL[n.kind]}</Badge>
                        <span className="min-w-0 flex-1 basis-44 line-clamp-2 text-sm text-fg sm:line-clamp-none sm:truncate">{n.title}</span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-muted">{n.snippet}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, count, children, wide }: { title: string; count: number; children: ReactNode; wide?: boolean }) {
  return (
    <Card className={wide ? 'xl:col-span-2' : undefined} title={`${title} · ${count}`}>
      {children}
    </Card>
  )
}
