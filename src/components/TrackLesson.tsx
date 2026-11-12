import { trackLessons } from '../data/trackLessons'
import { cheatsheets } from '../data/cheatsheets'
import { useStore } from '../state/context'
import { buildHash } from '../state/router'
import { CopyCommand } from './CopyCommand'
import { Card, PageHeader } from './ui'

export function TrackLesson({ code }: { code: string }) {
  const { idx, curriculum } = useStore()
  const lesson = trackLessons.find((l) => l.code === code)
  if (!lesson)
    return (
      <Card title="Конспект не найден">
        <a className="text-sm text-accent" href={buildHash('cheatsheets')}>
          К конспектам и шпаргалкам
        </a>
      </Card>
    )
  return (
    <div>
      <PageHeader
        eyebrow={`Учиться · конспект трека ${lesson.code}`}
        title={lesson.title}
        description={`${lesson.minutes} минут: чтение, выбор решения и короткая самопроверка. Конспект не увеличивает прогресс.`}
      />
      <a className="mb-4 inline-block text-sm text-accent" href={buildHash('cheatsheets')}>
        Все конспекты и шпаргалки
      </a>
      <p className="mb-6 text-sm leading-relaxed text-muted">{lesson.intro}</p>
      <div className="space-y-5">
        {lesson.sections.map((section) => (
          <Card key={section.title} title={section.title}>
            <p className="mb-4 text-sm leading-relaxed text-muted">{section.rule}</p>
            <table className="mb-4 w-full table-fixed text-left text-xs">
              <thead>
                <tr>
                  <th className="w-1/2 pb-2 pr-3 text-subtle">Ситуация</th>
                  <th className="pb-2 text-subtle">Выбор</th>
                </tr>
              </thead>
              <tbody>
                {section.choices.map(([situation, choice]) => (
                  <tr key={situation}>
                    <td className="py-2 pr-3 align-top wrap-anywhere text-fg">{situation}</td>
                    <td className="py-2 align-top wrap-anywhere text-muted">{choice}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="rounded-2xl border border-ok/20 bg-ok/[0.05] p-3">
              <h3 className="mb-2 text-sm font-semibold text-ok">Проверка</h3>
              <CopyCommand cmd={section.command} inline />
              <p className="mt-2 text-xs leading-relaxed text-muted">{section.check}</p>
              {section.scope && (
                <p className="mt-2 text-xs text-subtle">Где выполнять: {section.scope}</p>
              )}
            </div>
            <h3 className="mt-4 mb-2 text-sm font-semibold">Типичные ошибки</h3>
            <ul className="mb-4 list-disc space-y-1 pl-5 text-xs text-muted">
              {section.mistakes.map((mistake) => (
                <li key={mistake}>{mistake}</li>
              ))}
            </ul>
            <nav
              aria-label={`Практика: ${section.title}`}
              className="flex flex-wrap gap-x-4 gap-y-2"
            >
              {section.taskIds.map((id) => (
                <a
                  key={id}
                  className="text-xs wrap-anywhere text-accent hover:underline"
                  href={buildHash('roadmap', { task: id })}
                >
                  {id} · {idx.taskById.get(id)?.title}
                </a>
              ))}
              {section.incidentIds?.map((id) => (
                <a
                  key={id}
                  className="text-xs wrap-anywhere text-accent hover:underline"
                  href={buildHash('incidents', { id })}
                >
                  Инцидент · {curriculum.incidents.find((d) => d.id === id)?.title}
                </a>
              ))}
              {section.exerciseIds?.map((id) => (
                <a
                  key={id}
                  className="text-xs wrap-anywhere text-accent hover:underline"
                  href={buildHash('trainer', { scope: 'exercises', item: id })}
                >
                  Тренажёр ·{' '}
                  {curriculum.exercises.flatMap((s) => s.exercises).find((e) => e.id === id)?.text}
                </a>
              ))}
              {section.cheatsheetIds?.map((id) => (
                <a
                  key={id}
                  className="text-xs wrap-anywhere text-accent hover:underline"
                  href={buildHash('cheatsheets', { id })}
                >
                  Шпаргалка · {cheatsheets.find((s) => s.id === id)?.title}
                </a>
              ))}
            </nav>
          </Card>
        ))}
      </div>
      <p className="mt-5 text-xs leading-relaxed text-muted">
        Команды выполняются внутри контейнера своего проекта из корня ai-platform-labs, если у блока
        не указан другой контекст. Имена сервисов, пути и параметры сверяйте с пошаговым планом
        задачи. Цифры в примерах — условия опыта; подтверждением служат собственные результаты и
        выполненные критерии приёмки.
      </p>
    </div>
  )
}
