import {
  Camera,
  ExternalLink,
  FileText,
  FolderGit2,
  GitCommitHorizontal,
  Link2,
  Trash2,
} from 'lucide-react'
import { EVIDENCE_TYPE_LABEL, isUrl } from '../lib/labels'
import type { Evidence, EvidenceType } from '../types'
import { Button } from './ui'

const EVIDENCE_ICON: Record<EvidenceType, typeof Link2> = {
  commit: GitCommitHorizontal,
  repo: FolderGit2,
  screenshot: Camera,
  url: Link2,
  note: FileText,
}

export function EvidenceItem({
  evidence,
  onRemove,
}: {
  evidence: Evidence
  onRemove?: () => void
}) {
  const Icon = EVIDENCE_ICON[evidence.type]
  const linkable = isUrl(evidence.value)
  return (
    <div className="flex items-start gap-3 rounded-xl bg-surface px-4 py-3 shadow-card">
      <Icon
        size={15}
        className="mt-0.5 shrink-0 text-accent"
        aria-label={EVIDENCE_TYPE_LABEL[evidence.type]}
      />
      <div className="min-w-0 flex-1">
        {linkable ? (
          <a
            href={evidence.value}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 break-all text-sm text-fg hover:text-accent hover:underline"
          >
            {evidence.value} <ExternalLink size={11} className="shrink-0 text-subtle" />
          </a>
        ) : (
          <div
            className={`text-sm break-words whitespace-pre-wrap text-fg ${evidence.type === 'commit' || evidence.type === 'repo' || evidence.type === 'screenshot' ? 'font-mono text-xs' : ''}`}
          >
            {evidence.value}
          </div>
        )}
        {evidence.description && (
          <div className="mt-0.5 text-xs text-muted">{evidence.description}</div>
        )}
        <div className="mt-0.5 text-[12px] text-subtle">
          {EVIDENCE_TYPE_LABEL[evidence.type]} ·{' '}
          {Number.isFinite(Date.parse(evidence.createdAt))
            ? new Date(evidence.createdAt).toLocaleDateString('ru-RU')
            : 'дата не сохранена'}
        </div>
      </div>
      {onRemove && (
        <Button
          size="sm"
          variant="ghost"
          aria-label="Удалить подтверждение"
          onClick={() => {
            if (window.confirm('Удалить это подтверждение?')) onRemove()
          }}
        >
          <Trash2 size={13} />
        </Button>
      )}
    </div>
  )
}
