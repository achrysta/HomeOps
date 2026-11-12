import { AlertTriangle, CheckCircle2, CloudOff, Loader2 } from 'lucide-react'
import { useSyncStatus } from '../state/useSyncStatus'

const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '')

/** Компактный статус сохранения для sidebar. */
export function SyncIndicator() {
  const s = useSyncStatus()
  if (s.mode === 'synced') {
    return (
      <div className="flex items-start gap-1.5 text-ok" title={`Сохранено в файл ${s.file ?? 'data/progress.json'}`}>
        <CheckCircle2 size={13} className="mt-px shrink-0" />
        {/* полный путь — в подсказке и на странице «Резервная копия» */}
        <span className="min-w-0 truncate">
          Сохранено в {(s.file ?? 'data/progress.json').split('/').pop()}
          {s.savedAt && <span className="text-subtle"> · {time(s.savedAt)}</span>}
        </span>
      </div>
    )
  }
  if (s.mode === 'saving' || s.mode === 'connecting') {
    return (
      <div className="flex items-center gap-1.5 text-muted">
        <Loader2 size={13} className="shrink-0 animate-spin" />
        {s.mode === 'saving' ? 'Сохранение в файл…' : 'Подключение к хранилищу…'}
      </div>
    )
  }
  return (
    <div className={`flex items-start gap-1.5 ${s.mode === 'error' ? 'text-bad' : 'text-warn'}`}>
      {s.mode === 'error' ? <AlertTriangle size={13} className="mt-px shrink-0" /> : <CloudOff size={13} className="mt-px shrink-0" />}
      <span>{s.mode === 'error' ? 'Ошибка файла прогресса' : 'Только в браузере — файл недоступен'}</span>
    </div>
  )
}
