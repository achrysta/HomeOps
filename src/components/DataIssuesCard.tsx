import { CheckCircle2, Flag, RefreshCw } from 'lucide-react'
import { readIssues } from '../lib/dataReads'
import { ISSUE_KIND_LABEL, ISSUE_STATUS_LABEL, ISSUE_TYPE_LABEL } from '../lib/issues'
import { useApiResource } from '../lib/useApiResource'
import { ApiResourceMessage } from './ApiResourceMessage'
import { Badge, Button, Card, InfoTip } from './ui'

const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })

/** Замечания к программе: загрузка с ограниченным ожиданием и явной ошибкой. */
export function DataIssuesCard() {
  const { data: issues, loading, error, reload } = useApiResource(readIssues)
  const open = issues?.filter((x) => x.status === 'open') ?? []
  const done = issues?.filter((x) => x.status !== 'open') ?? []
  return (
    <Card title="Замечания к программе" subtitle={issues ? `открыто: ${open.length} · разобрано: ${done.length}` : undefined} action={
      <span className="flex items-center gap-2">
        <InfoTip label="Что это">«Есть проблема» сохраняет замечание к вопросу, задаче или материалу. Здесь появится результат разбора агентом.</InfoTip>
        <Button size="sm" variant="ghost" onClick={reload} aria-label="Обновить замечания"><RefreshCw size={13} /></Button>
      </span>
    }>
      <ApiResourceMessage loading={loading} error={error} label="замечания к программе" onRetry={reload} />
      {issues?.length === 0 && <p className="text-sm text-muted">Замечаний пока нет.</p>}
      {issues && issues.length > 0 && <ul className="space-y-2">
        {[...open, ...done.slice(-20)].reverse().map((x) => (
          <li key={x.id} className="rounded-lg bg-surface-2/60 px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              {x.status === 'open' ? <Flag size={12} className="text-warn" /> : <CheckCircle2 size={12} className="text-ok" />}
              <span>{ISSUE_KIND_LABEL[x.kind]}</span><span>· {ISSUE_TYPE_LABEL[x.type]}</span><span className="text-subtle">· {fmt(x.at)}</span>
              <Badge tone={x.status === 'open' ? 'warn' : x.status === 'fixed' ? 'ok' : 'neutral'} className="ml-auto">{ISSUE_STATUS_LABEL[x.status]}</Badge>
            </div>
            <div className="mt-1 text-sm break-words text-fg">{x.targetTitle || x.targetId}</div>
            {x.text && <div className="mt-0.5 text-xs leading-relaxed break-words text-muted">{x.text}</div>}
            {x.resolution && <div className="mt-1 text-xs leading-relaxed break-words text-ok">Сделано: {x.resolution}</div>}
          </li>
        ))}
      </ul>}
    </Card>
  )
}
