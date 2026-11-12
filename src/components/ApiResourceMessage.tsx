import { RefreshCw } from 'lucide-react'
import { Button } from './ui'

export function ApiResourceMessage({ loading, error, label, onRetry }: { loading: boolean; error?: string; label: string; onRetry: () => void }) {
  if (loading) return <p role="status" className="text-sm text-muted">Загружаем: {label}…</p>
  if (!error) return null
  return (
    <div className="rounded-xl bg-warn/10 p-3">
      <p role="alert" className="text-sm text-fg">Не удалось загрузить: {label}.</p>
      <p className="mt-1 text-xs text-muted">{error}. Проверьте, что дашборд запущен, и повторите попытку.</p>
      <Button size="sm" className="mt-3" onClick={onRetry}><RefreshCw size={13} /> Повторить</Button>
    </div>
  )
}
