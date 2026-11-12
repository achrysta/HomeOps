import { useMemo, useState } from 'react'
import { DIAGNOSTIC_POLICY } from '../config/learning'
import {
  diagnosticCorrect,
  diagnosticPool,
  diagnosticRecommendations,
  nextDiagnosticQuestion,
  type DiagnosticAnswer,
} from '../lib/diagnostics'
import { useStore } from '../state/context'
import { buildHash } from '../state/router'
import { useNow } from '../state/useNow'
import { InlineText } from '../components/InlineText'
import { Badge, Button, Card, InfoTip, PageHeader } from '../components/ui'

const STATUS = {
  untested: 'Не проверялось',
  insufficient: 'Мало данных',
  review: 'Повторить',
  solid: 'Уверенные ответы',
}
export function DiagnosticsPage() {
  const { curriculum, progress, vacancy, idx } = useStore()
  const now = useNow()
  const currentPool = useMemo(() => diagnosticPool(curriculum, vacancy), [curriculum, vacancy])
  const [run, setRun] = useState<{
    startedAt: number
    answers: DiagnosticAnswer[]
    finished: boolean
    pool: ReturnType<typeof diagnosticPool>
    vacancy: typeof vacancy
  } | null>(null)
  // Профиль может измениться из другой вкладки; начатая выборка остаётся той же.
  const pool = run?.pool ?? currentPool
  const runVacancy = run?.vacancy ?? vacancy
  const [selection, setSelection] = useState<number[]>([])
  const [confident, setConfident] = useState(false)
  const next = run ? nextDiagnosticQuestion(pool, run.answers) : null
  const timeUp = !!run && now - run.startedAt >= DIAGNOSTIC_POLICY.maxMinutes * 60_000
  const summary =
    run && (run.finished || !next || timeUp)
      ? diagnosticRecommendations(curriculum, progress, runVacancy, pool, run.answers)
      : null
  const start = () => {
    setRun({ startedAt: Date.now(), answers: [], finished: false, pool: currentPool, vacancy })
    setSelection([])
    setConfident(false)
  }
  const answer = (skip = false) => {
    if (!run || !next) return
    setRun({
      ...run,
      answers: [
        ...run.answers,
        {
          questionId: next.question.id,
          selection: skip ? [] : selection,
          correct: !skip && diagnosticCorrect(next.question, selection),
          confident: !skip && confident,
        },
      ],
    })
    setSelection([])
    setConfident(false)
  }
  return (
    <div>
      <PageHeader
        eyebrow="Учиться"
        title="Входная диагностика"
        description={
          <>
            {DIAGNOSTIC_POLICY.minMinutes}–{DIAGNOSTIC_POLICY.maxMinutes} минут на карту знаний и
            рекомендации.{' '}
            <InfoTip label="Что означает диагностика">
              Это выборка знакомых вопросов, а не подтверждение навыков. Неверные или неуверенные
              ответы получают уточняющие вопросы. Диагностика не пишет попытки, статистику
              тренажёра, уровни навыков, зачёт задач или соответствие роли. Рекомендация читать
              быстрее не отменяет предыдущие практические задачи.
            </InfoTip>
          </>
        }
      />
      {!run ? (
        <Card
          title="С чего начать подготовку"
          subtitle={`Вопросы из существующих банков по навыкам роли «${vacancy.title}». До ${DIAGNOSTIC_POLICY.maxQuestions} вопросов.`}
        >
          <p className="mb-5 text-sm text-muted">
            Отвечайте без подсказок и отмечайте уверенность. Навыки, которых нет в выборке,
            останутся непроверенными. Результат доступен в этой вкладке до нового запуска.
          </p>
          <Button variant="primary" size="lg" disabled={!pool.length} onClick={start}>
            Начать диагностику
          </Button>
        </Card>
      ) : summary ? (
        <div className="space-y-5">
          <Card
            title="Карта знаний"
            subtitle={`Ответов: ${run.answers.length}. Это рекомендации, а не уровни навыков.`}
            action={<Button onClick={start}>Повторить</Button>}
          >
            <ul className="space-y-3">
              {summary.knowledge.map((k) => (
                <li
                  key={k.skillId}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0">
                    {idx.skillById.get(k.skillId)?.title ?? k.skillId}
                  </span>
                  <Badge
                    tone={
                      k.status === 'solid' ? 'info' : k.status === 'review' ? 'warn' : 'neutral'
                    }
                  >
                    {STATUS[k.status]}
                    {k.total ? ` · ${k.correct}/${k.total}` : ''}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Как использовать результат">
            <h3 className="mb-2 text-sm font-semibold">Чтение, которое можно пройти обзорно</h3>
            {summary.skim.length ? (
              <ul className="mb-4 space-y-2">
                {summary.skim.map((t) => (
                  <li key={t.id}>
                    <a
                      className="text-sm text-accent hover:underline"
                      href={buildHash('roadmap', { task: t.id })}
                    >
                      {t.title}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-sm text-muted">
                Для пропуска подробного чтения данных пока недостаточно.
              </p>
            )}
            <h3 className="mb-2 text-sm font-semibold">Треки с опорой на уверенные ответы</h3>
            {summary.faster.length ? (
              <ul className="space-y-2">
                {summary.faster.map((t) => (
                  <li key={t.id}>
                    <a
                      className="text-sm text-accent hover:underline"
                      href={buildHash('roadmap', { track: t.id })}
                    >
                      {t.title}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                Начните с основного маршрута и повторите слабые темы.
              </p>
            )}
            <p className="mt-4 text-xs text-muted">
              Можно раньше знакомиться с теорией этих треков; зависимости практики и критерии
              приёмки сохраняются.
            </p>
          </Card>
          <Card title="Разбор выборки">
            {run.answers.map((a) => {
              const q = pool.find((p) => p.question.id === a.questionId)!.question
              return (
                <details key={a.questionId} className="mb-3">
                  <summary className="cursor-pointer text-sm text-fg">
                    {a.correct ? 'Верно' : 'Повторить'} · {q.text}
                  </summary>
                  <p className="mt-2 text-xs text-muted">{q.explanation}</p>
                </details>
              )
            })}
          </Card>
        </div>
      ) : (
        next && (
          <Card
            title={`Вопрос ${run.answers.length + 1}`}
            subtitle={idx.trackById.get(next.trackId)?.title}
            action={
              <Button variant="ghost" size="sm" onClick={() => setRun({ ...run, finished: true })}>
                Завершить сейчас
              </Button>
            }
          >
            <h2 className="mb-4 text-base font-semibold">
              <InlineText text={next.question.text} />
            </h2>
            {next.question.correct.length > 1 && (
              <p className="mb-3 text-xs text-muted">Выберите все подходящие варианты</p>
            )}
            <div className="space-y-2">
              {next.question.options.map((option, i) => (
                <label
                  key={i}
                  className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-xl p-3 text-sm ${selection.includes(i) ? 'bg-accent/10' : 'bg-surface-2'}`}
                >
                  <input
                    className="mt-1 accent-accent"
                    type={next.question.correct.length > 1 ? 'checkbox' : 'radio'}
                    name="diagnostic-answer"
                    checked={selection.includes(i)}
                    onChange={() =>
                      setSelection(
                        next.question.correct.length > 1
                          ? selection.includes(i)
                            ? selection.filter((n) => n !== i)
                            : [...selection, i]
                          : [i],
                      )
                    }
                  />
                  <span className="min-w-0">
                    <InlineText text={option} />
                  </span>
                </label>
              ))}
            </div>
            <label className="mt-4 flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                className="accent-accent"
                checked={confident}
                onChange={(e) => setConfident(e.target.checked)}
              />
              Ответил уверенно, без угадывания
            </label>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="lg"
                disabled={!selection.length}
                onClick={() => answer()}
              >
                Следующий вопрос
              </Button>
              <Button onClick={() => answer(true)}>Не знаю</Button>
            </div>
          </Card>
        )
      )}
    </div>
  )
}
