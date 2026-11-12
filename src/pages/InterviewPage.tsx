import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  EyeOff,
  MessageSquareText,
  Siren,
} from 'lucide-react'
import { lazy, useEffect, useRef, useState } from 'react'
import { AsyncContent } from '../components/AsyncContent'
import { ReportIssue } from '../components/ReportIssue'
import { TrainerTabs } from '../components/SectionTabs'
import { Badge, Button, InfoTip, PageHeader, ProgressBar, Segmented, Stat } from '../components/ui'
import { INTERVIEW_RATING_LABEL, INTERVIEW_REVIEW_DAYS } from '../config/weights'
import { incidentStatusFor } from '../lib/incidents'
import { EXPLAIN_RATINGS, explainRating, interviewReviewTopics } from '../lib/interview'
import { INTERVIEW_RATING_TONE, pct, toneForPct } from '../lib/labels'
import type { TopicReadiness } from '../lib/progress'
import { todayReviews } from '../lib/today'
import { useStore } from '../state/context'
import { buildHash, navigate, setSkillParam, useRoute } from '../state/router'
import { useLocalState } from '../state/useLocalState'
import { useNow } from '../state/useNow'
import type { InterviewQuestion, InterviewTopic } from '../types'

const SystemDesign = lazy(() =>
  import('../components/SystemDesign').then((m) => ({ default: m.SystemDesign })),
)

/** Режим — параметр view ссылки. Старые значения (mock, stories, resume) открывают список тем. */
type Mode = 'topics' | 'review' | 'design'
const MODES: readonly Mode[] = ['topics', 'review', 'design']

const EXPLAIN_HINT = `Ответьте вслух, оцените себя вслепую, потом сверьтесь с ключевыми тезисами и оцените ещё раз. Оценка задаёт срок повторения: «${INTERVIEW_RATING_LABEL[0]}» — сразу, «${INTERVIEW_RATING_LABEL[1]}» — через ${INTERVIEW_REVIEW_DAYS[1]} день, «${INTERVIEW_RATING_LABEL[2]}» — через ${INTERVIEW_REVIEW_DAYS[2]} дней. Это самопроверка: на обучение и навыки не влияет.`

const TOPIC_GROUPS: { group: InterviewTopic['group']; title: string; hint: string }[] = [
  {
    group: 'devops',
    title: 'Платформа и DevOps-база',
    hint: 'Linux, сети, Docker, Kubernetes, CI/CD, IaC, базы данных и очереди.',
  },
  {
    group: 'mlops',
    title: 'ML/AI-платформа',
    hint: 'Темы треков специализации: обслуживание моделей, LLM, наблюдаемость, RAG и оценка качества.',
  },
]

export function InterviewPage() {
  const { interview, curriculum, progress } = useStore()
  const [open, setOpen] = useLocalState<Record<string, boolean>>('interview.open', {})
  const { params } = useRoute()
  const view = params.get('view') ?? 'topics'
  const mode: Mode = (MODES as readonly string[]).includes(view) ? (view as Mode) : 'topics'
  const now = useNow()
  const dueCount = todayReviews(curriculum, progress, now).interview
  // Ссылка на вопрос (?q=id, например из плана на сегодня): его тема раскрыта, вопрос подсвечен
  const focusQuestion = params.get('q') ?? ''
  const focusTopic = interview.topics.find((t) =>
    t.topic.questions.some((q) => q.id === focusQuestion),
  )?.topic.id
  const review = mode === 'review'
  const dueTopics = review
    ? new Map(
        interviewReviewTopics(curriculum.interviewTopics, progress.interview.answers, now).map(
          (t) => [t.id, t.questions],
        ),
      )
    : null

  if (mode === 'design')
    return (
      <div>
        <PageHeader
          eyebrow="Практика"
          title="Проектирование"
          description="Кейсы проектирования платформы: свой ответ, отметка аспектов вслепую, затем разбор-ориентир и типичные ошибки."
          actions={<TrainerTabs active="design" />}
        />
        <AsyncContent label="Проектирование">
          <SystemDesign />
        </AsyncContent>
      </div>
    )

  return (
    <div>
      <PageHeader
        eyebrow="Практика"
        title="Своими словами"
        description={
          <>
            Объясните вслух, затем сверьтесь с ключевыми тезисами и типичной ошибкой.{' '}
            <InfoTip label="Как устроена самопроверка">{EXPLAIN_HINT}</InfoTip>
          </>
        }
        actions={<TrainerTabs active="explain" />}
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          size="sm"
          value={mode}
          onChange={(v) => navigate('interview', { view: v })}
          options={[
            { value: 'topics', label: 'Все темы' },
            { value: 'review', label: `Пора повторить · ${dueCount}` },
          ]}
        />
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Освоено" value={pct(interview.pct)} tone={toneForPct(interview.pct)}>
          <ProgressBar value={interview.pct} tone={toneForPct(interview.pct)} />
        </Stat>
        <Stat
          label="Оценено вопросов"
          value={`${interview.answered}/${interview.total}`}
          hint={`сверено с тезисами: ${interview.checked}`}
        />
        <Stat
          label="Пора повторить"
          value={dueCount}
          tone={dueCount ? 'warn' : 'neutral'}
          hint="срок повторения по оценке наступил"
        />
        <Stat
          label="Переоценка"
          value={interview.overrated}
          tone={interview.overrated ? 'warn' : 'neutral'}
          hint="вслепую оценили себя выше, чем после сверки"
        />
      </div>

      {review && dueTopics?.size === 0 ? (
        <p className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-muted shadow-card">
          Повторять пока нечего: новые вопросы — во вкладке «Все темы».
        </p>
      ) : (
        <div className="space-y-8">
          {TOPIC_GROUPS.map((g) => {
            const topics = interview.topics.filter(
              (t) => t.topic.group === g.group && (!dueTopics || dueTopics.has(t.topic.id)),
            )
            if (!topics.length) return null
            return (
              <section key={g.group}>
                <h2 className="text-sm font-semibold text-fg">{g.title}</h2>
                <p className="mb-3 text-xs text-muted">{g.hint}</p>
                <div className="space-y-4">
                  {topics.map((t) => {
                    const defaultOpen = review || t.topic.id === focusTopic
                    return (
                      <TopicCard
                        key={t.topic.id}
                        readiness={t}
                        questions={dueTopics?.get(t.topic.id) ?? t.topic.questions}
                        focus={focusQuestion}
                        open={open[t.topic.id] ?? defaultOpen}
                        onToggle={() =>
                          setOpen({ ...open, [t.topic.id]: !(open[t.topic.id] ?? defaultOpen) })
                        }
                      />
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TopicCard({
  readiness,
  questions,
  open,
  onToggle,
  focus,
}: {
  readiness: TopicReadiness
  questions: InterviewQuestion[]
  open: boolean
  onToggle: () => void
  focus: string
}) {
  const { curriculum, progress, idx } = useStore()
  const { topic } = readiness

  return (
    <section className="rounded-xl bg-surface shadow-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left"
      >
        {open ? (
          <ChevronDown size={16} className="shrink-0 text-subtle" />
        ) : (
          <ChevronRight size={16} className="shrink-0 text-subtle" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-fg sm:inline">{topic.title}</span>
          <span className="block text-xs text-subtle sm:ml-2 sm:inline">
            {[
              topic.trackIds.map((id) => idx.trackById.get(id)?.code).join(', '),
              `${readiness.answered}/${topic.questions.length} оценено`,
              `${readiness.checked} сверено`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        {/* на узком экране — отдельной строкой под названием, на широком — справа */}
        <span className="flex w-full flex-wrap items-center gap-2 pl-7 sm:w-auto sm:pl-0">
          {readiness.overrated > 0 && <Badge tone="warn">переоценка: {readiness.overrated}</Badge>}
          <span className="min-w-24 flex-1 sm:w-32 sm:flex-none">
            <ProgressBar value={readiness.pct} tone={toneForPct(readiness.pct)} size="sm" />
          </span>
          <span className="w-10 text-right font-mono text-xs text-muted tabular-nums">
            {pct(readiness.pct)}
          </span>
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-4 py-4">
          <div className="space-y-3">
            {questions.map((q) => (
              <Question key={q.id} question={q} focused={q.id === focus} />
            ))}
          </div>
          {(topic.skillIds.length > 0 || topic.incidentIds.length > 0) && (
            <div className="mt-5 space-y-3 rounded-xl bg-surface-2/40 p-4 text-xs text-muted">
              {topic.skillIds.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  Навыки темы:
                  {topic.skillIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSkillParam(id)}
                      className="rounded-md bg-surface px-1.5 py-0.5 text-accent shadow-card hover:text-fg"
                    >
                      {idx.skillById.get(id)?.title ?? id}
                    </button>
                  ))}
                </div>
              )}
              {topic.incidentIds.length > 0 && (
                <div>
                  <div className="mb-1">Стенды по теме — те же знания на практике:</div>
                  <ul className="space-y-0.5">
                    {topic.incidentIds.map((id) => {
                      const def = curriculum.incidents.find((d) => d.id === id)
                      return def ? (
                        <li key={id} className="flex items-center gap-1.5">
                          {incidentStatusFor(def, progress) === 'solved' ? (
                            <CheckCircle2 size={12} className="shrink-0 text-ok" />
                          ) : (
                            <Siren size={12} className="shrink-0 text-subtle" />
                          )}
                          <a
                            href={buildHash('incidents', { id })}
                            className="text-accent hover:underline"
                          >
                            {def.title}
                          </a>
                        </li>
                      ) : null
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Question({ question, focused }: { question: InterviewQuestion; focused: boolean }) {
  const { progress, dispatch } = useStore()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' })
  }, [focused])
  const questionId = question.id
  const answer = progress.interview.answers[questionId]
  const current = answer ? explainRating(answer.rating) : null
  const blind = answer?.blindRating !== undefined ? explainRating(answer.blindRating) : null
  const [showPoints, setShowPoints] = useState(false)
  const [showNote, setShowNote] = useState(!!answer?.note)

  const togglePoints = () => {
    if (!showPoints) dispatch({ type: 'interview/check', questionId })
    setShowPoints(!showPoints)
  }

  return (
    <div
      ref={ref}
      data-question-id={question.id}
      className={`rounded-md border bg-surface-2/30 p-3 ${focused ? 'border-accent/60 ring-1 ring-accent/40' : 'border-line'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 text-sm font-medium text-fg">{question.text}</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowNote(!showNote)}
            disabled={!answer}
            className="rounded p-1 text-subtle hover:text-accent disabled:opacity-40"
            title={answer ? 'Заметка к ответу' : 'Сначала оцените ответ'}
            aria-label="Заметка"
          >
            <MessageSquareText size={14} />
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Segmented
          size="sm"
          value={current}
          onChange={(rating) =>
            dispatch({
              type: 'interview/rating',
              questionId,
              rating: current === rating ? null : rating,
            })
          }
          options={EXPLAIN_RATINGS.map((r) => ({
            value: r,
            label: INTERVIEW_RATING_LABEL[r],
            tone: INTERVIEW_RATING_TONE[r],
          }))}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={!answer}
          onClick={togglePoints}
          title={answer ? undefined : 'Сначала оцените себя вслепую — потом сверьтесь'}
        >
          {showPoints ? <EyeOff size={13} /> : <BookOpenCheck size={13} />}{' '}
          {showPoints ? 'Скрыть тезисы' : answer?.checkedAt ? 'Тезисы' : 'Сверить с тезисами'}
        </Button>
        {answer && !answer.checkedAt && (
          <span className="text-[11px] text-subtle">оценка вслепую</span>
        )}
      </div>
      {showPoints && (
        <div className="mt-3 rounded-md border border-accent/30 bg-accent/5 p-3 text-xs">
          <div className="mb-1 font-medium text-accent">Что должно прозвучать</div>
          <ul className="list-disc space-y-0.5 pl-4 text-fg">
            {question.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <p className="mt-2 flex gap-1 text-warn">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" /> Частая ошибка:{' '}
            {question.pitfall}
          </p>
          <p className="mt-2 text-muted">
            Если после сверки ответ выглядит иначе — оцените его ещё раз. Оценка вслепую сохранится
            для сравнения.
          </p>
          <ReportIssue
            kind="interview"
            targetId={question.id}
            targetTitle={question.text}
            className="mt-2"
          />
        </div>
      )}
      {answer?.checkedAt && blind !== null && current !== null && blind !== current && (
        <div className={`mt-2 text-[11px] ${blind > current ? 'text-warn' : 'text-ok'}`}>
          Вслепую: {INTERVIEW_RATING_LABEL[blind]} → после сверки: {INTERVIEW_RATING_LABEL[current]}
        </div>
      )}
      {showNote && answer && (
        <textarea
          className="field mt-2 min-h-16 text-xs"
          placeholder="Тезисы своего ответа, что упустили…"
          value={answer.note ?? ''}
          onChange={(e) => dispatch({ type: 'interview/note', questionId, note: e.target.value })}
        />
      )}
    </div>
  )
}
