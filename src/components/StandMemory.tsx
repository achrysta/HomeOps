import { Gauge, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchLabMemory, formatMemory, memoryShare, type LabMemory } from '../lib/labs'
import { Badge, Button, InfoTip, ProgressBar } from './ui'

const REFRESH_MS = 5000

/** Память контейнеров запущенного стенда (как docker stats): лимит, OOMKilled и перезапуски видны без терминала. */
export function StandMemory({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{ containers: LabMemory[] } | { error: string } | null>(null)

  // Пока блок открыт, обновляем снимок; следующий запрос — после ответа на предыдущий, чтобы медленный Docker не копил запросы
  useEffect(() => {
    if (!open) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      void fetchLabMemory(id).then((r) => {
        if (!alive) return
        setData(r)
        timer = setTimeout(load, REFRESH_MS)
      })
    load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [open, id])

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={open ? 'secondary' : 'ghost'}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <Gauge size={13} /> {open ? 'Скрыть память' : 'Память контейнеров'}
        </Button>
        {open && (
          <InfoTip label="Что показывает память">
            Как docker stats: занятая память без файлового кэша — от лимита контейнера, а без лимита
            — от всей памяти Docker. Обновляется каждые 5 с, пока блок открыт. OOMKilled — последнюю
            остановку контейнера вызвал OOM killer: процесс упёрся в лимит. У учебного Linux-сервера
            OOM внутри убивает процесс, а не контейнер — это видно в dmesg и journalctl.
          </InfoTip>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-3 rounded-lg bg-surface-2 p-3">
          {data === null ? (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" /> Смотрю память контейнеров…
            </div>
          ) : 'error' in data ? (
            <p className="text-xs text-bad">Не удалось получить память: {data.error}</p>
          ) : data.containers.length === 0 ? (
            <p className="text-xs text-muted">У стенда нет контейнеров.</p>
          ) : (
            data.containers.map((m) => {
              const share = memoryShare(m)
              return (
                <div key={m.name} className="min-w-0">
                  <div className="mb-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className="font-mono text-fg">{m.service}</span>
                    <span className="text-muted">
                      {m.used === null
                        ? `${m.state === 'restarting' ? 'перезапускается' : 'не запущен'}${m.limit ? ` · лимит ${formatMemory(m.limit)}` : ''}`
                        : `${formatMemory(m.used)} из ${m.limit ? formatMemory(m.limit) : m.available ? `${formatMemory(m.available)} (вся память Docker)` : '—'}`}
                    </span>
                    {!m.limit && <Badge>без лимита</Badge>}
                    {m.oomKilled && <Badge tone="bad">OOMKilled</Badge>}
                    {m.restarts > 0 && <Badge tone="warn">перезапусков: {m.restarts}</Badge>}
                  </div>
                  {share !== null && (
                    <ProgressBar
                      value={share}
                      size="sm"
                      tone={share >= 0.9 ? 'bad' : share >= 0.75 ? 'warn' : 'ok'}
                    />
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
