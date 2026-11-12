import { useCallback, useEffect, useState } from 'react'
import { withDeadline } from './apiResource'

/** Новый запрос отменяет старый; ответ после ухода со страницы не применяется. */
export function useApiResource<T>(read: (signal: AbortSignal) => Promise<T>, version: string | number = 0) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ version: typeof version; attempt: number; data?: T; error?: string }>()
  useEffect(() => {
    const controller = new AbortController()
    void withDeadline(read, 10_000, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setResult({ version, attempt, data }) },
      (error: unknown) => { if (!controller.signal.aborted) setResult({ version, attempt, error: error instanceof Error ? error.message : 'Сервер недоступен' }) },
    )
    return () => controller.abort()
  }, [read, version, attempt])
  const current = result?.version === version && result.attempt === attempt ? result : undefined
  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  return { data: current?.data, error: current?.error, loading: !current, reload }
}
