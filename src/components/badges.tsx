import { CheckCircle2, Cpu, Lock, PlayCircle, ShieldAlert } from 'lucide-react'
import {
  AVAILABILITY_LABEL,
  IMPORTANCE_LABEL,
  IMPORTANCE_TONE,
  KIND_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
} from '../lib/labels'
import type { Availability, Verification } from '../lib/progress'
import type { Importance, Priority, TaskKind, TaskStatus } from '../types'
import { Badge } from './ui'

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
}

export function ImportanceBadge({ importance }: { importance: Importance | null }) {
  if (!importance) return null
  return <Badge tone={IMPORTANCE_TONE[importance]}>{IMPORTANCE_LABEL[importance]}</Badge>
}

export function KindBadge({ kind }: { kind: TaskKind }) {
  const tone = kind === 'integration' ? 'accent' : kind === 'lab' ? 'info' : kind === 'quiz' ? 'violet' : 'neutral'
  return <Badge tone={tone}>{KIND_LABEL[kind]}</Badge>
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge tone={PRIORITY_TONE[priority]} className="font-mono">
      {priority}
    </Badge>
  )
}

export function EnvBadge() {
  return (
    <Badge tone="violet" title="Зависит от окружения (GPU / WSL / Kubernetes с GPU). Не блокирует дорожную карту.">
      <Cpu size={11} /> Зависит от окружения
    </Badge>
  )
}

export function VerificationBadge({ verification }: { verification: Verification }) {
  if (verification === 'open') return null
  if (verification === 'verified') {
    return (
      <Badge tone="ok" title="Выполнено + все критерии приёмки + подтверждение">
        <CheckCircle2 size={11} /> Подтверждено
      </Badge>
    )
  }
  const text = verification === 'needs_evidence' ? 'Нет подтверждения' : verification === 'needs_criteria' ? 'Не все критерии' : 'Не подтверждено'
  return (
    <Badge tone="warn" title="Задача отмечена «Выполнено», но не засчитана в прогресс">
      <ShieldAlert size={11} /> {text}
    </Badge>
  )
}

export function AvailabilityBadge({ availability }: { availability: Availability }) {
  if (availability === 'ready') {
    return (
      <Badge tone="accent">
        <PlayCircle size={11} /> {AVAILABILITY_LABEL.ready}
      </Badge>
    )
  }
  if (availability === 'locked') {
    return (
      <Badge tone="neutral">
        <Lock size={11} /> {AVAILABILITY_LABEL.locked}
      </Badge>
    )
  }
  if (availability === 'env_skipped') return <Badge tone="violet">{AVAILABILITY_LABEL.env_skipped}</Badge>
  return null
}
