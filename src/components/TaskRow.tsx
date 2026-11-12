import { CheckCircle2, Circle, CircleDashed, CircleSlash, Cpu, Lock } from 'lucide-react'
import { getAvailability, getTaskProgress, getVerification, missingPrerequisites, taskImportance } from '../lib/progress'
import { setTaskParam } from '../state/router'
import { useStore } from '../state/context'
import type { TaskDef } from '../types'
import { ImportanceBadge, KindBadge, StatusBadge, VerificationBadge } from './badges'

export function StatusIcon({ task }: { task: TaskDef }) {
  const { idx, progress } = useStore()
  const a = getAvailability(task, idx, progress)
  const tp = getTaskProgress(progress, task.id)
  if (a === 'done') return <CheckCircle2 size={16} className="shrink-0 text-ok" aria-label="Засчитано" />
  if (a === 'env_skipped' || a === 'blocked') return <CircleSlash size={16} className="shrink-0 text-bad" aria-label="Заблокировано" />
  if (tp.status === 'completed') return <CheckCircle2 size={16} className="shrink-0 text-warn" aria-label="Не подтверждено" />
  if (tp.status === 'in_progress') return <CircleDashed size={16} className="shrink-0 text-info" aria-label="В работе" />
  if (a === 'locked') return <Lock size={15} className="shrink-0 text-subtle" aria-label="Ждёт предыдущих задач" />
  return <Circle size={16} className="shrink-0 text-accent" aria-label="Можно начинать" />
}

export function TaskRow({ task, showTrack = false, compact = false }: { task: TaskDef; showTrack?: boolean; compact?: boolean }) {
  const { idx, progress, vacancy } = useStore()
  const tp = getTaskProgress(progress, task.id)
  const verification = getVerification(task, tp)
  const missing = missingPrerequisites(task, idx, progress)
  const track = idx.trackById.get(task.trackId)
  const importance = taskImportance(task, vacancy, idx)

  return (
    <button
      type="button"
      onClick={() => setTaskParam(task.id)}
      className="group flex w-full items-start gap-3 rounded-md border border-transparent px-3 py-2.5 text-left transition-colors hover:border-line hover:bg-surface-2"
    >
      <span className="mt-0.5">
        <StatusIcon task={task} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-xs text-subtle">{task.id}</span>
          <span className="text-sm font-medium text-fg group-hover:text-accent">{task.title}</span>
        </span>
        {!compact && (
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-subtle">
            {showTrack && track && <span className="text-muted">{track.code} · {track.title}</span>}
            <KindBadge kind={task.kind} />
            {importance === 'required' && <ImportanceBadge importance={importance} />}
            {(tp.status === 'in_progress' || tp.status === 'blocked') && <StatusBadge status={tp.status} />}
            <VerificationBadge verification={verification} />
            {task.environmentDependency && (
              <span title="Зависит от окружения (GPU / WSL / Kubernetes с GPU). Не блокирует дорожную карту.">
                <Cpu size={12} className="text-violet" />
              </span>
            )}
            <span className="font-mono">{task.priority}</span>
            {task.optional && <span>необязательно</span>}
            {missing.length > 0 && <span>· ждёт {missing.join(', ')}</span>}
          </span>
        )}
      </span>
    </button>
  )
}
