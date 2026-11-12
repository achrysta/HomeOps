import { ArrowRight, BookOpen } from 'lucide-react'
import { lazy } from 'react'
import { AsyncContent } from '../components/AsyncContent'
import { cheatsheets, type CheatPractice } from '../data/cheatsheets'
import { LESSON_CATALOG } from '../data/trackLessonFormat'
import { CopyCommand } from '../components/CopyCommand'
import { Badge, Card, PageHeader } from '../components/ui'
import { useStore } from '../state/context'
import { buildHash, useRoute } from '../state/router'
import { MaterialsTabs } from '../components/SectionTabs'

const TrackLesson = lazy(() =>
  import('../components/TrackLesson').then((m) => ({ default: m.TrackLesson })),
)

export function CheatsheetsPage() {
  const { curriculum } = useStore()
  const { params } = useRoute()
  const selected = cheatsheets.find((s) => s.id === params.get('id'))
  const lesson = params.get('id') === 'python-lesson' ? 'A' : params.get('lesson')
  if (lesson)
    return (
      <AsyncContent label={`конспект трека ${lesson}`}>
        <TrackLesson code={lesson} />
      </AsyncContent>
    )
  const link = (p: CheatPractice) => {
    if (p.kind === 'task')
      return {
        title: curriculum.tasks.find((t) => t.id === p.id)?.title,
        href: buildHash('roadmap', { task: p.id }),
        label: 'Задача',
      }
    if (p.kind === 'gym')
      return {
        title: curriculum.gyms.find((d) => d.id === p.id)?.title,
        href: buildHash('gyms', { id: p.id }),
        label: 'Зал',
      }
    if (p.kind === 'incident')
      return {
        title: curriculum.incidents.find((d) => d.id === p.id)?.title,
        href: buildHash('incidents', { id: p.id }),
        label: 'Инцидент',
      }
    return {
      title: curriculum.exercises.flatMap((s) => s.exercises).find((e) => e.id === p.id)?.text,
      href: buildHash('trainer', { scope: 'exercises', item: p.id }),
      label: 'Тренажёр',
    }
  }
  return (
    <div>
      <PageHeader
        eyebrow="Учиться"
        title={selected?.title ?? 'Конспекты и шпаргалки'}
        description="Десять минут на инструмент, затем практика с проверкой результата. Чтение шпаргалки не увеличивает прогресс."
        actions={selected ? undefined : <MaterialsTabs active="cheatsheets" />}
      />
      {selected && (
        <a
          className="mb-5 inline-block text-xs text-accent hover:underline"
          href={buildHash('cheatsheets')}
        >
          Все шпаргалки
        </a>
      )}
      {!selected && (
        <Card
          className="mb-6"
          title="Конспекты по трекам"
          subtitle="Правила выбора, таблицы, проверка и типичные ошибки. Чтение ничего не засчитывает."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {LESSON_CATALOG.map((l) => (
              <a
                key={l.code}
                className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-accent hover:bg-accent/10"
                href={buildHash('cheatsheets', { lesson: l.code })}
              >
                <span className="font-mono">{l.code}</span> ·{' '}
                {curriculum.tracks.find((t) => t.id === l.trackId)?.title}
                <span className="mt-1 block text-xs text-muted">{l.minutes} мин</span>
              </a>
            ))}
          </div>
        </Card>
      )}
      <div className="space-y-6">
        {(selected ? [selected] : cheatsheets).map((sheet) => (
          <Card
            key={sheet.id}
            title={
              <a className="hover:text-accent" href={buildHash('cheatsheets', { id: sheet.id })}>
                {sheet.title}
              </a>
            }
            action={
              <Badge>
                <BookOpen size={12} />
                {sheet.minutes} мин
              </Badge>
            }
          >
            <p className="mb-5 text-sm leading-relaxed text-muted">{sheet.intro}</p>
            {(selected ? sheet.sections : sheet.sections.slice(0, 1)).map((section) => (
              <section key={section.title} className="mb-5">
                <h3 className="mb-2 text-sm font-semibold text-fg">{section.title}</h3>
                <p className="mb-3 text-sm text-muted">{section.rule}</p>
                <div className="space-y-2">
                  {section.commands.map((command) => (
                    <div key={command}>
                      <CopyCommand cmd={command} inline />
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-2xl border border-ok/20 bg-ok/[0.05] p-3 text-xs leading-relaxed text-muted">
                  <b className="text-ok">Проверка: </b>
                  {section.check}
                </div>
                <p className="mt-2 text-xs text-muted">
                  <b>Типичная ошибка: </b>
                  {section.mistake}
                </p>
              </section>
            ))}
            {!selected && (
              <a
                href={buildHash('cheatsheets', { id: sheet.id })}
                className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline"
              >
                Прочитать шпаргалку <ArrowRight size={14} />
              </a>
            )}
            <h3 className="mb-2 text-sm font-semibold text-fg">Закрепить в практике</h3>
            <ul className="space-y-2">
              {sheet.practice.map((p) => {
                const l = link(p)
                return l.title ? (
                  <li key={p.kind + p.id} className="min-w-0">
                    <a
                      href={l.href}
                      className="block wrap-anywhere text-sm text-accent hover:underline"
                    >
                      {l.label} · {l.title}
                    </a>
                  </li>
                ) : null
              })}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  )
}
