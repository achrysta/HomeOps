import { CheckCircle2, ChevronLeft, RotateCcw, XCircle } from 'lucide-react'
import { useState } from 'react'
import { pct } from '../lib/labels'
import {
  attemptPasses,
  bestRatio,
  hasPassed,
  isCorrect,
  scoreAttempt,
  shuffle,
  type Answers,
} from '../lib/quiz'
import type { QuizAttempt, QuizQuestion } from '../types'
import { InlineText } from './InlineText'
import { Badge, Button, Card, ProgressBar } from './ui'

interface Prepared {
  question: QuizQuestion
  /** Порядок показа вариантов: индексы исходного массива options */
  order: number[]
}

type Phase =
  | { kind: 'intro' }
  | { kind: 'running'; items: Prepared[] }
  | { kind: 'result'; items: Prepared[]; answers: Answers; correct: number; passed: boolean }

const fmt = (iso: string) =>
  Number.isFinite(Date.parse(iso))
    ? new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
    : 'Дата не сохранена'

export function QuizRunner({
  title,
  description,
  threshold,
  expectedTotal,
  attempts,
  buildQuestions,
  onSubmit,
  onBack,
  backLabel,
  unlocks,
}: {
  title: string
  description: string
  threshold: number
  expectedTotal: number
  attempts: QuizAttempt[]
  /** Набор вопросов для новой попытки (перемешивание или выборка) */
  buildQuestions: () => QuizQuestion[]
  onSubmit: (
    result: Omit<QuizAttempt, 'id' | 'at'>,
    perQuestion: { questionId: string; correct: boolean }[],
  ) => void
  onBack: () => void
  backLabel: string
  unlocks?: string
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' })
  const [answers, setAnswers] = useState<Answers>({})
  const best = bestRatio(attempts, expectedTotal)
  const passedEver = hasPassed(attempts, expectedTotal)

  const start = () => {
    const items = buildQuestions().map((question) => ({
      question,
      order: shuffle(question.options.map((_, i) => i)),
    }))
    setAnswers({})
    setPhase({ kind: 'running', items })
    window.scrollTo({ top: 0 })
  }

  const toggle = (q: QuizQuestion, option: number) => {
    const multi = q.correct.length > 1
    const current = answers[q.id] ?? []
    const next = multi
      ? current.includes(option)
        ? current.filter((x) => x !== option)
        : [...current, option]
      : [option]
    setAnswers({ ...answers, [q.id]: next })
  }

  const submit = (items: Prepared[]) => {
    const questions = items.map((i) => i.question)
    const res = scoreAttempt(questions, answers, threshold)
    onSubmit(
      res,
      questions.map((q) => ({ questionId: q.id, correct: isCorrect(q, answers[q.id]) })),
    )
    setPhase({ kind: 'result', items, answers, correct: res.correct, passed: res.passed })
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="mx-auto max-w-3xl">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-accent"
      >
        <ChevronLeft size={15} /> {backLabel}
      </button>
      <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
      <p className="mt-1 text-sm text-muted">{description}</p>

      {phase.kind === 'intro' && (
        <Card className="mt-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={passedEver ? 'ok' : attempts.length ? 'warn' : 'neutral'}>
              {passedEver ? 'Сдан' : attempts.length ? 'Не сдан' : 'Ещё не проходили'}
            </Badge>
            {best !== null && (
              <span className="text-sm text-muted">
                Лучший результат: <b className="font-mono text-fg">{pct(best)}</b>
              </span>
            )}
            <span className="text-sm text-muted">
              Проходной балл: <b className="font-mono text-fg">{pct(threshold)}</b>
            </span>
          </div>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Вопросы и варианты перемешиваются при каждой попытке.</li>
            <li>
              Где правильных ответов несколько, это указано — засчитывается только полное
              совпадение.
            </li>
            <li>
              После отправки покажем разбор каждого вопроса. Пересдавать можно сколько угодно.
            </li>
            {unlocks && <li>Сдача теста открывает: {unlocks}.</li>}
          </ul>
          <Button variant="primary" className="mt-5" onClick={start}>
            {attempts.length ? 'Пройти ещё раз' : 'Начать тест'}
          </Button>
        </Card>
      )}

      {phase.kind === 'running' && (
        <RunningView
          items={phase.items}
          answers={answers}
          onToggle={toggle}
          onSubmit={() => submit(phase.items)}
        />
      )}

      {phase.kind === 'result' && (
        <ResultView
          phase={phase}
          threshold={threshold}
          unlocks={unlocks}
          onRetry={start}
          onBack={onBack}
          backLabel={backLabel}
        />
      )}

      {attempts.length > 0 && phase.kind !== 'running' && (
        <Card className="mt-6" title={`История попыток · ${attempts.length}`}>
          <ul className="divide-y divide-line/60 text-sm">
            {[...attempts].reverse().map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-1.5">
                {attemptPasses(a, expectedTotal) ? (
                  <CheckCircle2 size={14} className="text-ok" />
                ) : (
                  <XCircle size={14} className="text-bad" />
                )}
                <span className="text-muted">{fmt(a.at)}</span>
                <span className="ml-auto font-mono text-fg tabular-nums">
                  {a.correct}/{a.total} · {pct(a.correct / a.total)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function RunningView({
  items,
  answers,
  onToggle,
  onSubmit,
}: {
  items: Prepared[]
  answers: Answers
  onToggle: (q: QuizQuestion, option: number) => void
  onSubmit: () => void
}) {
  const answered = items.filter((i) => (answers[i.question.id] ?? []).length > 0).length
  return (
    <div className="mt-6 space-y-4">
      <div className="sticky top-16 z-10 rounded-xl bg-surface/95 px-4 py-2.5 shadow-card backdrop-blur">
        <div className="mb-1.5 flex justify-between text-xs text-muted">
          <span>Отвечено</span>
          <span className="font-mono tabular-nums">
            {answered} из {items.length}
          </span>
        </div>
        <ProgressBar value={answered / items.length} size="sm" />
      </div>
      {items.map(({ question, order }, n) => {
        const multi = question.correct.length > 1
        const chosen = answers[question.id] ?? []
        return (
          <Card key={question.id}>
            <div className="mb-3 flex gap-2 text-sm font-medium text-fg">
              <span className="font-mono text-subtle">{n + 1}.</span>
              <InlineText text={question.text} />
            </div>
            {multi && <div className="mb-2 text-xs text-warn">Несколько правильных вариантов</div>}
            <div className="space-y-1.5">
              {order.map((opt) => {
                const active = chosen.includes(opt)
                return (
                  <label
                    key={opt}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors ${active ? 'border-accent bg-accent/10 text-fg' : 'border-line text-fg hover:border-subtle'}`}
                  >
                    <input
                      type={multi ? 'checkbox' : 'radio'}
                      name={question.id}
                      checked={active}
                      onChange={() => onToggle(question, opt)}
                      className="mt-0.5 accent-[var(--accent)]"
                    />
                    <InlineText text={question.options[opt]} />
                  </label>
                )
              })}
            </div>
          </Card>
        )
      })}
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={onSubmit} disabled={answered < items.length}>
          Завершить и проверить
        </Button>
        {answered < items.length && (
          <span className="text-xs text-muted">Ответьте на все вопросы</span>
        )}
      </div>
    </div>
  )
}

function ResultView({
  phase,
  threshold,
  unlocks,
  onRetry,
  onBack,
  backLabel,
}: {
  phase: Extract<Phase, { kind: 'result' }>
  threshold: number
  unlocks?: string
  onRetry: () => void
  onBack: () => void
  backLabel: string
}) {
  const total = phase.items.length
  const ratio = phase.correct / total
  return (
    <div className="mt-6 space-y-4">
      <div
        className={`rounded-lg border px-5 py-4 ${phase.passed ? 'border-ok/30 bg-ok/10' : 'border-bad/30 bg-bad/10'}`}
      >
        <div className="flex flex-wrap items-baseline gap-3">
          <span
            className={`font-mono text-3xl font-semibold tabular-nums ${phase.passed ? 'text-ok' : 'text-bad'}`}
          >
            {pct(ratio)}
          </span>
          <span className="text-sm text-fg">
            {phase.correct} из {total} ·{' '}
            {phase.passed ? 'тест сдан' : `не сдан — нужно ${pct(threshold)}`}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">
          {phase.passed
            ? unlocks
              ? `Задача засчитана. Открыта: ${unlocks}.`
              : 'Отличный результат.'
            : 'Разберите ошибки ниже, вернитесь к материалам задачи и попробуйте снова.'}
        </p>
        <div className="mt-3 flex gap-2">
          <Button onClick={onRetry}>
            <RotateCcw size={14} /> Пройти ещё раз
          </Button>
          <Button variant="ghost" onClick={onBack}>
            {backLabel}
          </Button>
        </div>
      </div>

      {phase.items.map(({ question, order }, n) => {
        const chosen = phase.answers[question.id] ?? []
        const ok = isCorrect(question, chosen)
        return (
          <Card key={question.id} className={ok ? '' : 'border-bad/40'}>
            <div className="mb-3 flex gap-2 text-sm font-medium text-fg">
              {ok ? (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ok" />
              ) : (
                <XCircle size={16} className="mt-0.5 shrink-0 text-bad" />
              )}
              <span className="font-mono text-subtle">{n + 1}.</span>
              <InlineText text={question.text} />
            </div>
            <div className="space-y-1.5">
              {order.map((opt) => {
                const right = question.correct.includes(opt)
                const picked = chosen.includes(opt)
                const style = right
                  ? 'border-ok/40 bg-ok/10'
                  : picked
                    ? 'border-bad/40 bg-bad/10'
                    : 'border-line opacity-70'
                return (
                  <div
                    key={opt}
                    className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm text-fg ${style}`}
                  >
                    <span className="w-4 shrink-0 text-center">
                      {right ? '✓' : picked ? '✗' : ''}
                    </span>
                    <span className="min-w-0">
                      <InlineText text={question.options[opt]} />
                      {picked && !right && question.optionNotes?.[opt] && (
                        <span className="mt-1 block text-xs leading-relaxed text-bad">
                          <InlineText text={question.optionNotes[opt]} />
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm leading-relaxed text-muted">
              <InlineText text={question.explanation} />
            </p>
          </Card>
        )
      })}
    </div>
  )
}
