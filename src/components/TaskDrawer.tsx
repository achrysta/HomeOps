import { AlertTriangle, CheckSquare, ChevronRight, ClipboardCheck, Plus, Square } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { QUIZ_PASS_THRESHOLD, TASK_KIND_WEIGHT } from '../config/weights'
import { labSteps } from '../data/labSteps'
import { withTaskPlan } from '../lib/taskPlan'
import { EVIDENCE_TYPE_LABEL, LEVEL_LABEL, pct, STATUS_LABEL } from '../lib/labels'
import { bestRatio, hasPassed } from '../lib/quiz'
import {
  getAvailability,
  getTaskProgress,
  getVerification,
  requiresEvidence,
  taskGrantsLevel,
  taskImportance,
} from '../lib/progress'
import { useStore } from '../state/context'
import { buildHash, setSkillParam, setTaskParam } from '../state/router'
import { SaveToggle } from './SaveToggle'
import type { EvidenceType, TaskStatus } from '../types'
import { AvailabilityBadge, EnvBadge, ImportanceBadge, KindBadge, PriorityBadge, VerificationBadge } from './badges'
import { EvidenceItem } from './EvidenceList'
import { LabStepPlan } from './LabStepPlan'
import { TaskResources } from './TaskResources'
import { TaskTiming } from './TaskTiming'
import { StatusIcon } from './TaskRow'
import { Badge, Button, Drawer, Segmented } from './ui'
import { ReportIssue } from './ReportIssue'

const STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'completed', 'blocked']
const STATUS_SEG_TONE = { not_started: 'neutral', in_progress: 'info', completed: 'ok', blocked: 'bad' } as const
const EVIDENCE_TYPES: EvidenceType[] = ['commit', 'repo', 'url', 'screenshot', 'note']

const EVIDENCE_PLACEHOLDER: Record<EvidenceType, string> = {
  commit: 'a1b2c3d или ссылка на коммит',
  repo: 'gitlab.com/<вы>/ai-platform-labs/<папка задачи>',
  url: 'https://… (MR, pipeline, дашборд, отчёт)',
  screenshot: 'docs/evidence/<задача>-<что-на-скрине>.png',
  note: 'Что именно сделано и как проверено',
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wider text-subtle uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function TaskDrawer({ taskId }: { taskId: string | null }) {
  const { idx } = useStore()
  const task = taskId ? idx.taskById.get(taskId) : undefined
  const close = () => setTaskParam(null)
  return (
    <Drawer open={!!task} onClose={close} title={task ? <DrawerTitle taskId={task.id} /> : null}>
      {task && <TaskDetail key={task.id} taskId={task.id} />}
    </Drawer>
  )
}

function DrawerTitle({ taskId }: { taskId: string }) {
  const { idx, progress, vacancy } = useStore()
  const task = idx.taskById.get(taskId)!
  const track = idx.trackById.get(task.trackId)
  const tp = getTaskProgress(progress, taskId)
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold tracking-[0.14em] text-subtle uppercase">
        {track?.code} · {track?.title} · <span className="normal-case tracking-normal">{task.id}</span>
      </div>
      <h2 className="text-xl leading-snug font-bold tracking-tight text-fg sm:text-[22px]">{task.title}</h2>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <KindBadge kind={task.kind} />
        <PriorityBadge priority={task.priority} />
        <ImportanceBadge importance={taskImportance(task, vacancy, idx)} />
        <VerificationBadge verification={getVerification(task, tp)} />
        {tp.status !== 'completed' && <AvailabilityBadge availability={getAvailability(task, idx, progress)} />}
        {task.environmentDependency && <EnvBadge />}
        {task.optional && <Badge>необязательно</Badge>}
        <SaveToggle kind="task" id={task.id} label />
        <ReportIssue kind="task" targetId={task.id} targetTitle={task.title} className="ml-auto" />
      </div>
    </div>
  )
}

function TaskDetail({ taskId }: { taskId: string }) {
  const { idx, progress, dispatch, vacancy, levels } = useStore()
  const task = withTaskPlan(idx.taskById.get(taskId)!, labSteps)
  const tp = getTaskProgress(progress, taskId)
  const verification = getVerification(task, tp)
  const availability = getAvailability(task, idx, progress)
  const dependents = idx.dependents.get(taskId) ?? []
  const criteriaDone = task.acceptanceCriteria.filter((c) => tp.criteriaDone.includes(c)).length

  const [evType, setEvType] = useState<EvidenceType>('repo')
  const [evValue, setEvValue] = useState('')
  const [evDesc, setEvDesc] = useState('')

  const addEvidence = (e: FormEvent) => {
    e.preventDefault()
    if (!evValue.trim()) return
    dispatch({ type: 'task/evidence/add', id: taskId, evidence: { type: evType, value: evValue, description: evDesc } })
    setEvValue('')
    setEvDesc('')
  }

  return (
    <div>
      {task.kind === 'quiz' ? (
        <QuizSummary taskId={taskId} />
      ) : (
        <>
        <Section title="Статус">
          <Segmented
            value={tp.status}
            onChange={(status) => dispatch({ type: 'task/status', id: taskId, status })}
            options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s], tone: STATUS_SEG_TONE[s] }))}
          />
          {availability === 'locked' && tp.status === 'not_started' && (
            <p className="mt-2 text-xs text-muted">Предыдущие задачи ещё не засчитаны — начать можно, но по дорожной карте лучше сначала закрыть их.</p>
          )}
          {task.environmentDependency && (
            <p className="mt-2 text-xs text-muted">
              Зависит от окружения: если окружение не позволяет выполнить лабораторную, отметьте <b>Заблокировано</b> — задача исключится из прогресса и не будет блокировать зависимые.
            </p>
          )}
          {tp.status === 'completed' && verification !== 'verified' && (
            <div className="mt-3 flex gap-2 rounded-xl border border-warn/30 bg-warn/[0.08] px-4 py-3 text-xs text-warn">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div>
                Задача не засчитана в прогресс и соответствие роли.
                {(verification === 'needs_criteria' || verification === 'needs_both') && ' Отметьте все критерии приёмки.'}
                {(verification === 'needs_evidence' || verification === 'needs_both') && ' Приложите хотя бы одно подтверждение: коммит, репозиторий, ссылку, скриншот или заметку.'}
              </div>
            </div>
          )}
        </Section>
  
        </>
      )}

      <Section title="Описание">
        <p className="text-sm leading-relaxed text-fg">{task.description}</p>
        {task.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {task.tags.map((t) => (
              <span key={t} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">
                #{t}
              </span>
            ))}
          </div>
        )}
      </Section>

      {task.steps && task.steps.length > 0 && (
        <Section title="Что сделать">
          <LabStepPlan task={task} />
        </Section>
      )}

      <Section title={`Материалы · ${task.resourceIds.length}`}>
        <TaskResources resourceIds={task.resourceIds} />
        <p className="mt-2 text-[11px] text-subtle">Отметка «прочитано» не влияет на прогресс — засчитывается только выполненная задача.</p>
      </Section>

      {task.kind !== 'quiz' && (
        <>
        <Section title={`Критерии приёмки · ${criteriaDone}/${task.acceptanceCriteria.length}`}>
          <ul className="space-y-1">
            {task.acceptanceCriteria.map((c) => {
              const done = tp.criteriaDone.includes(c)
              return (
                <li key={c}>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'task/criterion', id: taskId, criterion: c, done: !done })}
                    className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-2"
                    aria-pressed={done}
                  >
                    {done ? <CheckSquare size={16} className="mt-0.5 shrink-0 text-ok" /> : <Square size={16} className="mt-0.5 shrink-0 text-subtle" />}
                    <span className={done ? 'text-muted' : 'text-fg'}>{c}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Section>
  
        <Section title={`Подтверждения · ${tp.evidence.length}`} aside={!requiresEvidence(task) && <span className="text-[11px] text-subtle">для чтения необязательно</span>}>
          <div className="space-y-2">
            {tp.evidence.map((ev) => (
              <EvidenceItem key={ev.id} evidence={ev} onRemove={() => dispatch({ type: 'task/evidence/remove', id: taskId, evidenceId: ev.id })} />
            ))}
          </div>
          <form onSubmit={addEvidence} className="mt-3 space-y-2.5 rounded-xl border border-dashed border-line p-4">
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Тип подтверждения">
              {EVIDENCE_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={evType === t}
                  onClick={() => setEvType(t)}
                  className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${evType === t ? 'bg-accent/12 text-accent ring-1 ring-accent/40' : 'bg-surface-2 text-muted hover:text-fg'}`}
                >
                  {EVIDENCE_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            {evType === 'note' ? (
              <textarea className="field min-h-16" placeholder={EVIDENCE_PLACEHOLDER[evType]} value={evValue} onChange={(e) => setEvValue(e.target.value)} aria-label="Подтверждение" />
            ) : (
              <input className="field font-mono text-xs" placeholder={EVIDENCE_PLACEHOLDER[evType]} value={evValue} onChange={(e) => setEvValue(e.target.value)} aria-label="Подтверждение" />
            )}
            <input className="field" placeholder="Описание (необязательно): что это доказывает" value={evDesc} onChange={(e) => setEvDesc(e.target.value)} aria-label="Описание подтверждения" />
            <Button type="submit" variant="primary" size="sm" disabled={!evValue.trim()}>
              <Plus size={13} /> Добавить подтверждение
            </Button>
          </form>
        </Section>
  
        </>
      )}

      <Section title="Заметки">
        <textarea
          className="field min-h-28 font-mono text-xs leading-relaxed"
          placeholder="Команды, грабли, выводы, ссылки…"
          value={tp.notes}
          onChange={(e) => dispatch({ type: 'task/notes', id: taskId, notes: e.target.value })}
        />
      </Section>
      <details className="group mb-2 rounded-xl bg-surface-2/50">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-xs text-muted select-none hover:text-fg">
          <ChevronRight size={13} className="transition-transform group-open:rotate-90" />
          Подробнее: зависимости, навыки роли, время и вес задачи
        </summary>
        <div className="border-t border-line/60 px-4 pt-4">
        {(task.prerequisites.length > 0 || dependents.length > 0) && (
          <Section title="Зависимости">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-muted">Предыдущие задачи</div>
                {task.prerequisites.length === 0 && <div className="text-xs text-subtle">нет</div>}
                {task.prerequisites.map((id) => (
                  <DepLink key={id} id={id} />
                ))}
              </div>
              <div>
                <div className="mb-1 text-xs text-muted">Открывает</div>
                {dependents.length === 0 && <div className="text-xs text-subtle">нет</div>}
                {dependents.map((id) => (
                  <DepLink key={id} id={id} />
                ))}
              </div>
            </div>
          </Section>
        )}

        {task.vacancyRequirementIds.length > 0 && (
          <Section title="Навыки роли">
            <div className="space-y-1">
              {task.vacancyRequirementIds.map((sid) => {
                const skill = idx.skillById.get(sid)
                const req = vacancy.requirements.find((r) => r.skillId === sid)
                const info = levels.get(sid)
                return (
                  <button
                    key={sid}
                    type="button"
                    onClick={() => setSkillParam(sid)}
                    title="Открыть карточку навыка"
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-2"
                  >
                    <span className="text-fg">{skill?.title ?? sid}</span>
                    <span className="flex items-center gap-2">
                      {req && <ImportanceBadge importance={req.importance} />}
                      <span className="font-mono text-xs text-muted tabular-nums">
                        {info?.current ?? 0} / {req?.targetLevel ?? '—'}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </Section>
        )}

          <Section title="Время и трудоёмкость">
            <TaskTiming task={task} progress={tp} />
          </Section>
          <div className="mb-4 text-xs text-subtle">
            Процент прогресса обучения взвешенный: трудоёмкая практика влияет сильнее чтения.
            Вес этой задачи: <span className="font-mono text-muted">{TASK_KIND_WEIGHT[task.kind]}</span>.
            {' '}Подтверждает уровень навыка до{' '}
            <span className="font-mono text-muted">{taskGrantsLevel(task)}</span> ({LEVEL_LABEL[taskGrantsLevel(task)]})
            {task.optional && ' · необязательная — не входит в знаменатель прогресса'}
          </div>
        </div>
      </details>
    </div>
  )
}

function DepLink({ id }: { id: string }) {
  const { idx } = useStore()
  const t = idx.taskById.get(id)
  if (!t) return null
  return (
    <button type="button" onClick={() => setTaskParam(id)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-2">
      <StatusIcon task={t} />
      <span className="font-mono text-xs text-subtle">{t.id}</span>
      <span className="truncate text-fg">{t.title}</span>
    </button>
  )
}

function QuizSummary({ taskId }: { taskId: string }) {
  const { progress, idx } = useStore()
  const attempts = getTaskProgress(progress, taskId).quizAttempts ?? []
  const best = bestRatio(attempts)
  const passed = hasPassed(attempts)
  const last = attempts.at(-1)
  const unlocks = idx.dependents.get(taskId) ?? []
  return (
    <Section title="Контрольный тест">
      <div className={`rounded-xl px-5 py-4 ${passed ? 'border border-ok/30 bg-ok/[0.08]' : 'bg-surface shadow-card'}`}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {passed ? <Badge tone="ok">Сдан</Badge> : attempts.length ? <Badge tone="warn">Не сдан</Badge> : <Badge>Ещё не проходили</Badge>}
          {best !== null && (
            <span className="text-muted">
              Лучший результат: <b className="font-mono text-fg">{pct(best)}</b> · попыток: {attempts.length}
            </span>
          )}
          <span className="text-muted">Проходной балл: {pct(QUIZ_PASS_THRESHOLD)}</span>
        </div>
        {last && !passed && last.wrongIds.length > 0 && <p className="mt-2 text-xs text-muted">В последней попытке ошибок: {last.wrongIds.length}. Разбор каждого вопроса покажется после следующей попытки.</p>}
        {unlocks.length > 0 && <p className="mt-2 text-xs text-muted">Открывает: {unlocks.join(', ')}</p>}
        <a
          href={buildHash('quiz', { id: taskId })}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2.5 text-[15px] font-semibold text-bg shadow-sm hover:opacity-90"
        >
          <ClipboardCheck size={14} /> {passed ? 'Пройти ещё раз' : attempts.length ? 'Пересдать' : 'Пройти тест'}
        </a>
      </div>
      <p className="mt-2 text-xs text-subtle">Тест засчитывается автоматически при результате от {pct(QUIZ_PASS_THRESHOLD)} — вручную статус не меняется.</p>
    </Section>
  )
}
