import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Compass,
  Dumbbell,
  Lock,
  Trophy,
  XCircle,
} from 'lucide-react'
import { Badge, Card, InfoTip, PageHeader, ProgressBar, Stat } from '../components/ui'
import { FINAL_EXAM_PER_TRACK, QUIZ_PASS_THRESHOLD, QUIZ_SIZE } from '../config/weights'
import { DIAGNOSTIC_POLICY } from '../config/learning'
import { pct, toneForPct } from '../lib/labels'
import { getTaskProgress, missingPrerequisites } from '../lib/progress'
import { bestRatio, finalExamSize, hasPassed } from '../lib/quiz'
import { todayReviews } from '../lib/today'
import { useStore } from '../state/context'
import { buildHash, setTaskParam } from '../state/router'
import { useNow } from '../state/useNow'
import { RoadmapTabs } from '../components/SectionTabs'

export function TestsPage() {
  const { curriculum, idx, progress } = useStore()
  const rows = curriculum.quizzes.map((quiz) => {
    const task = idx.taskById.get(quiz.id)!
    const attempts = getTaskProgress(progress, quiz.id).quizAttempts ?? []
    return {
      quiz,
      task,
      track: idx.trackById.get(quiz.trackId)!,
      attempts,
      best: bestRatio(attempts),
      passed: hasPassed(attempts),
      missing: missingPrerequisites(task, idx, progress),
      unlocks: idx.dependents.get(quiz.id) ?? [],
    }
  })
  const passedCount = rows.filter((r) => r.passed).length
  const now = useNow()
  // то же число, что у пункта «Тренажёр» в меню и на «Сегодня»
  const due = todayReviews(curriculum, progress, now).practice
  const examUnlocked = passedCount === rows.length
  const examTotal = finalExamSize(curriculum.quizzes)
  const examBest = bestRatio(progress.finalExam, examTotal)
  const examPassed = hasPassed(progress.finalExam, examTotal)
  const weak = rows.flatMap((r) => {
    const last = r.attempts.at(-1)
    return last && !r.passed ? [{ r, wrong: last.wrongIds.length }] : []
  })

  return (
    <div>
      <PageHeader
        eyebrow="Учиться"
        title="Контрольные тесты"
        actions={<RoadmapTabs active="tests" />}
        description={
          <>
            Проверьте понимание перед ключевой лабораторной.{' '}
            <InfoTip label="Как засчитывается контрольный тест">
              Проходной балл — {pct(QUIZ_PASS_THRESHOLD)} на полном наборе вопросов. Сданный тест
              засчитывается автоматически и поднимает навык только до «базового понимания» —
              практику подтверждают лабораторные.
            </InfoTip>
          </>
        }
      />

      {/* Вход в соседние режимы — одной строкой: диагностика для старта и тренажёр со всеми банками */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <a
          href={buildHash('diagnostics')}
          className="group flex min-w-0 items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 shadow-card"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-info/10 text-info">
            <Compass size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-fg group-hover:text-accent">
              Входная диагностика
            </span>
            <span className="block text-xs text-muted">
              С чего начать · {DIAGNOSTIC_POLICY.minMinutes}–{DIAGNOSTIC_POLICY.maxMinutes} минут,
              ничего не засчитывает
            </span>
          </span>
          <ArrowRight size={14} className="shrink-0 text-accent" />
        </a>
        <a
          href={buildHash('trainer', { mode: due ? 'due' : 'smart', scope: 'all' })}
          className="group flex min-w-0 items-center gap-3 rounded-2xl border border-accent/25 bg-accent/[0.06] px-4 py-3.5 hover:border-accent/50"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
            <Dumbbell size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-fg group-hover:text-accent">
              Тренажёр
            </span>
            <span className="block text-xs text-muted">
              Вопросы тестов, MLOps- и DevOps-база, упражнения
              {due ? ` · пора повторить ${due}` : ' · по одному, с разбором'}
            </span>
          </span>
          <ArrowRight size={14} className="shrink-0 text-accent" />
        </a>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat
          label="Сдано тестов"
          value={`${passedCount}/${rows.length}`}
          tone={passedCount === rows.length ? 'ok' : 'neutral'}
        >
          <ProgressBar value={passedCount / rows.length} tone="ok" />
        </Stat>
        <Stat label="Попыток всего" value={rows.reduce((a, r) => a + r.attempts.length, 0)} />
        <Stat
          label="Нужно пересдать"
          value={weak.length}
          tone={weak.length ? 'warn' : 'neutral'}
          hint="Последняя попытка ниже порога"
        />
        <Stat
          label="Сквозной экзамен"
          value={examBest === null ? '—' : pct(examBest)}
          tone={examPassed ? 'ok' : 'neutral'}
          hint={examPassed ? 'Сдан' : examUnlocked ? 'Открыт' : 'Откроется после всех тестов'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((r) => (
          <section key={r.quiz.id} className="flex flex-col rounded-xl bg-surface p-5 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/12 text-xs font-bold text-accent">
                    {r.track.code}
                  </span>
                  {r.track.title} · {Math.min(QUIZ_SIZE, r.quiz.questions.length)} из{' '}
                  {r.quiz.questions.length} вопросов банка
                </div>
                <button
                  type="button"
                  onClick={() => setTaskParam(r.task.id)}
                  className="mt-2 text-left text-base leading-snug font-semibold text-fg hover:text-accent"
                >
                  {r.task.title}
                </button>
              </div>
              {r.passed ? (
                <Badge tone="ok">
                  <CheckCircle2 size={11} /> Сдан
                </Badge>
              ) : r.attempts.length ? (
                <Badge tone="warn">
                  <XCircle size={11} /> Не сдан
                </Badge>
              ) : (
                <Badge>Не начат</Badge>
              )}
            </div>
            {r.best !== null && (
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs text-muted">
                  <span>Лучший результат · попыток: {r.attempts.length}</span>
                  <span className="font-semibold text-fg tabular-nums">{pct(r.best)}</span>
                </div>
                <ProgressBar value={r.best} tone={toneForPct(r.best)} size="sm" />
              </div>
            )}
            <div className="mt-3 space-y-1 text-xs text-muted">
              {r.missing.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Lock size={12} /> Рекомендуется сначала: {r.missing.join(', ')}
                </div>
              )}
              {r.unlocks.length > 0 && (
                <div>
                  Открывает:{' '}
                  {r.unlocks.map((id) => `${id} · ${idx.taskById.get(id)?.title}`).join('; ')}
                </div>
              )}
            </div>
            <a
              href={buildHash('quiz', { id: r.quiz.id })}
              className="mt-auto inline-flex items-center gap-1 self-start pt-4 text-sm font-medium text-accent hover:underline"
            >
              {r.passed ? 'Пройти ещё раз' : r.attempts.length ? 'Пересдать' : 'Начать тест'}{' '}
              <ArrowRight size={14} />
            </a>
          </section>
        ))}
      </div>

      <Card
        className="mt-6"
        title={
          <span className="flex items-center gap-2">
            <Trophy size={15} className="text-warn" /> Сквозной экзамен
          </span>
        }
        subtitle={`${rows.length * FINAL_EXAM_PER_TRACK} случайных вопросов: по ${FINAL_EXAM_PER_TRACK} из каждого трека. Итоговая проверка по всей программе.`}
      >
        {examUnlocked ? (
          <div className="flex flex-wrap items-center gap-4">
            <a
              href={buildHash('quiz', { id: 'final' })}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2.5 text-[15px] font-semibold text-bg shadow-sm hover:opacity-90"
            >
              <ClipboardCheck size={14} />{' '}
              {progress.finalExam.length ? 'Пройти ещё раз' : 'Начать экзамен'}
            </a>
            {examBest !== null && (
              <span className="text-sm text-muted">
                Лучший результат: {pct(examBest)} · попыток: {progress.finalExam.length}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Lock size={14} /> Откроется после сдачи всех {rows.length} тестов треков (сдано{' '}
            {passedCount}).
          </div>
        )}
      </Card>
    </div>
  )
}
