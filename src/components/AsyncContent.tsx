import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { Component, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Button, Card } from './ui'

/** Ожидание не остаётся бесконечным спиннером; поздний ответ всё ещё можно принять. */
export function LoadingContent({ label = 'раздел' }: { label?: string }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 10_000)
    return () => clearTimeout(timer)
  }, [])
  return (
    <Card>
      <div role="status" className="flex items-start gap-3">
        {slow ? <AlertTriangle size={20} className="shrink-0 text-warn" /> : <Loader2 size={20} className="shrink-0 animate-spin text-accent" />}
        <div className="min-w-0">
          <p className="font-semibold text-fg">{slow ? `Загрузка: ${label} — ответ задержался` : `Загружаем: ${label}…`}</p>
          {slow && <p className="mt-2 text-sm text-muted">Проверьте, что дашборд запущен. Можно подождать или повторить загрузку страницы.</p>}
        </div>
      </div>
      {slow && <Button className="mt-4" onClick={() => window.location.reload()}><RefreshCw size={15} /> Повторить загрузку</Button>}
    </Card>
  )
}

class ContentBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <Card>
        <div role="alert" className="flex items-start gap-3">
          <AlertTriangle size={20} className="shrink-0 text-warn" />
          <div className="min-w-0">
            <p className="font-semibold text-fg">Не удалось открыть: {this.props.label}</p>
            <p className="mt-2 text-sm text-muted">Проверьте, что дашборд запущен, и обновите страницу. После обновления приложения это загрузит новую версию раздела.</p>
          </div>
        </div>
        <Button className="mt-4" onClick={() => window.location.reload()}><RefreshCw size={15} /> Повторить загрузку</Button>
      </Card>
    )
  }
}

export function AsyncContent({ children, label = 'раздел' }: { children: ReactNode; label?: string }) {
  return <ContentBoundary label={label}><Suspense fallback={<LoadingContent label={label} />}>{children}</Suspense></ContentBoundary>
}
