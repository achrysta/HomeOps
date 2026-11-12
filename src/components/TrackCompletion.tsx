import { CheckCircle2 } from 'lucide-react'
import type { Track } from '../types'

export function TrackCompletion({ track, compact = false }: { track: Track; compact?: boolean }) {
  return <div className={`rounded-2xl border border-ok/25 bg-ok/[0.06] p-4 ${compact ? 'mt-3' : 'mb-5'}`}>
    <h3 className="flex items-center gap-2 text-sm font-semibold text-ok"><CheckCircle2 size={16} className="shrink-0" /> Все обязательные задачи засчитаны</h3>
    <div className={`mt-3 grid gap-3 ${compact ? '' : 'sm:grid-cols-2'}`}>
      <div><h4 className="mb-1 text-xs font-semibold text-fg">Что изучили</h4><ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted">{track.learned?.map((text) => <li key={text}>{text}</li>)}</ul></div>
      <div><h4 className="mb-1 text-xs font-semibold text-fg">Куда дальше</h4><ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted">{track.nextSteps?.map((text) => <li key={text}>{text}</li>)}</ul></div>
    </div>
  </div>
}
