import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/** Команда для терминала с кнопкой копирования. */
export function CopyCommand({ cmd, label, inline = false }: { cmd: string; label?: string; inline?: boolean }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd)
      clearTimeout(timer.current)
      setStatus('copied')
      timer.current = setTimeout(() => setStatus('idle'), 1500)
    } catch {
      setStatus('failed')
    }
  }
  const copied = status === 'copied'
  if (inline) return (
    <span className="inline max-w-full">
      <button type="button" onClick={() => void copy()} title={copied ? 'Скопировано' : 'Копировать'} aria-label={`Копировать: ${cmd}`} className="inline-flex max-w-full items-baseline gap-1 rounded bg-surface-2 px-1 py-0.5 align-baseline text-accent hover:bg-accent/10">
        <code className="min-w-0 whitespace-normal text-left font-mono text-[0.85em] [overflow-wrap:anywhere]">{cmd}</code>
        {copied ? <Check size={12} className="shrink-0 self-center text-ok" /> : <Copy size={12} className="shrink-0 self-center" />}
      </button>
      <span role="status" className={status === 'failed' ? 'ml-1 text-xs text-warn' : 'sr-only'}>{copied ? 'Скопировано' : status === 'failed' ? 'Буфер недоступен — выделите текст вручную' : ''}</span>
    </span>
  )
  return (
    <div className="min-w-0">
      {label && <div className="mb-1 text-xs text-muted">{label}</div>}
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg" title={cmd}>
          {cmd}
        </code>
        <button type="button" onClick={() => void copy()} className="shrink-0 text-subtle hover:text-fg" aria-label="Скопировать команду" title="Скопировать">
          {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
        </button>
      </div>
      {status === 'failed' && <p role="status" className="mt-1 text-xs text-warn">Буфер недоступен — выделите команду вручную.</p>}
    </div>
  )
}
