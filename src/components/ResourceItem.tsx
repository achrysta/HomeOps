import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { RESOURCE_TYPE_LABEL } from '../lib/labels'
import { useStore } from '../state/context'
import type { Resource } from '../types'
import { Badge } from './ui'
import { SaveToggle } from './SaveToggle'
import { ReportIssue } from './ReportIssue'

/** Материал доступен на русском: русскоязычный сам по себе или есть официальный перевод. */
export function ResourceItem({ resource, children }: { resource: Resource; children?: ReactNode }) {
  const { progress, dispatch } = useStore()
  const done = !!progress.resources[resource.id]?.completed
  const translated = resource.ru
  const ru = resource.language === 'ru' || !!translated
  const title = translated?.title ?? resource.title
  const href = translated?.url ?? resource.url

  return (
    <div className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-surface-2">
      <input
        type="checkbox"
        checked={done}
        onChange={() => dispatch({ type: 'resource/toggle', id: resource.id })}
        className="mt-1 accent-[var(--accent)]"
        aria-label={`Отметить «${title}» как изученное`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className={`inline-flex items-center gap-1 text-sm hover:text-accent hover:underline ${done ? 'text-muted line-through decoration-subtle' : 'text-fg'}`}
          >
            {title}
            <ExternalLink size={12} className="shrink-0 text-subtle" />
          </a>
          <Badge tone={ru ? 'ok' : 'neutral'} className="font-mono">
            {ru ? 'RU' : 'EN'}
          </Badge>
          <Badge>{RESOURCE_TYPE_LABEL[resource.type]}</Badge>
          {translated && (
            <a href={resource.url} target="_blank" rel="noreferrer noopener" className="text-[12px] text-subtle hover:text-accent hover:underline" title={resource.title}>
              оригинал на английском ↗
            </a>
          )}
        </div>
        {resource.note && <div className="mt-0.5 text-xs text-muted">{resource.note}</div>}
        {children}
        <ReportIssue kind="resource" targetId={resource.id} targetTitle={resource.title} className="mt-1" />
      </div>
      <SaveToggle kind="resource" id={resource.id} />
    </div>
  )
}
