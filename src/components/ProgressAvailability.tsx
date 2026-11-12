import { AlertTriangle, CloudOff, Download, RefreshCw, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { progressAccess } from '../lib/progressAvailability'
import { buildExport, downloadJSON, todayLocal } from '../lib/storage'
import { dismissSyncNotice, type SyncMode } from '../lib/sync'
import { useStore } from '../state/context'
import { useSyncStatus } from '../state/useSyncStatus'
import { LoadingContent } from './AsyncContent'
import { Button, Card, PageHeader } from './ui'

function useDelayedConnection(mode: SyncMode) {
  const [delayedMode, setDelayedMode] = useState<SyncMode>()
  useEffect(() => {
    if (mode !== 'connecting' && mode !== 'saving') return
    const timer = setTimeout(() => setDelayedMode(mode), 10_000)
    return () => clearTimeout(timer)
  }, [mode])
  return delayedMode === mode
}

function ExportLocalCopy() {
  const { curriculum, progress } = useStore()
  return <Button onClick={() => downloadJSON(`homeops-local-copy-${todayLocal()}.json`, buildExport(progress, curriculum))}><Download size={15} /> Скачать локальную копию</Button>
}

export function ProgressAvailability({ children }: { children: ReactNode }) {
  const sync = useSyncStatus()
  const delayed = useDelayedConnection(sync.mode)
  const [continuedOffline, setContinuedOffline] = useState(false)
  const access = progressAccess(sync.mode, sync.file, continuedOffline, delayed)
  if (access === 'content') return children
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-14">
      <PageHeader eyebrow="Прогресс" title={access === 'loading' ? 'Открываем ваш прогресс' : sync.mode === 'error' ? 'Не удалось прочитать прогресс' : 'Хранилище прогресса недоступно'} />
      {access === 'loading' ? <LoadingContent label="прогресс из файла" /> : (
        <Card>
          <div role="alert" className="space-y-3 text-sm text-muted">
            <AlertTriangle size={24} className="text-warn" />
            <p className="text-fg">{sync.mode === 'error' ? 'Запись в файл приостановлена, чтобы сохранить данные.' : 'Не удалось получить актуальную версию из файла. Копия браузера может быть устаревшей или пустой.'}</p>
            <p>{sync.mode === 'error' ? 'Скачайте локальную копию, проверьте файл прогресса и доступность хранилища, затем обновите страницу.' : 'Проверьте, что дашборд запущен, затем повторите загрузку. Локальную копию можно скачать сейчас.'}</p>
            {sync.mode === 'offline' && sync.message && <p className="break-words text-xs">{sync.message}</p>}
            {sync.mode === 'error' && sync.message && <details><summary className="cursor-pointer text-xs">Подробности ошибки</summary><p className="mt-2 break-words text-xs">{sync.message}</p></details>}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" size="lg" onClick={() => window.location.reload()}><RefreshCw size={16} /> Повторить загрузку</Button>
            <ExportLocalCopy />
            {sync.mode === 'offline' && <Button onClick={() => setContinuedOffline(true)}>Открыть копию браузера</Button>}
          </div>
        </Card>
      )}
    </main>
  )
}

/** Состояние после загрузки: страницы доступны, статус файла и действия видны всегда. */
export function ProgressNotice() {
  const sync = useSyncStatus()
  const delayed = useDelayedConnection(sync.mode)
  const unavailable = sync.mode === 'offline' || sync.mode === 'error' || delayed
  return (
    <>
      {sync.notice && <div className="mb-4 flex items-start gap-2 rounded-xl border border-info/30 bg-info/10 p-4 text-sm text-info"><span className="min-w-0 flex-1">{sync.notice}</span><button type="button" aria-label="Скрыть уведомление" onClick={dismissSyncNotice}><X size={16} /></button></div>}
      {unavailable && <section className="mb-6 rounded-2xl border border-warn/30 bg-warn/10 p-4" aria-label="Состояние хранилища">
        <div role="alert" className="flex items-start gap-2 text-sm">
          <CloudOff size={18} className="shrink-0 text-warn" />
          <div className="min-w-0">
            <p className="font-semibold text-fg">{delayed ? 'Сервер задерживает сохранение' : 'Файл прогресса недоступен'}</p>
            <p className="mt-1 text-muted">Изменения пока остаются в браузере. Скачайте копию перед закрытием вкладки. Проверьте, что дашборд запущен, затем обновите страницу.</p>
            {sync.message && <p className="mt-2 break-words text-xs text-muted">{sync.message}</p>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2"><ExportLocalCopy /><Button onClick={() => window.location.reload()}><RefreshCw size={14} /> Повторить подключение</Button></div>
      </section>}
    </>
  )
}
