/** Ограничивает весь запрос, включая чтение тела; поздний ответ не меняет результат. */
export function withDeadline<T>(request: (signal: AbortSignal) => Promise<T>, timeoutMs = 10_000, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      controller.abort()
      reject(new Error('Запрос отменён'))
    }
    const timer = setTimeout(() => {
      controller.abort()
      reject(new Error('Сервер не ответил за 10 секунд'))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', abort)
    }
    parent?.addEventListener('abort', abort, { once: true })
    if (parent?.aborted) abort()
    if (controller.signal.aborted) {
      cleanup()
      return
    }
    Promise.resolve().then(() => request(controller.signal)).then(
      (value) => { cleanup(); resolve(value) },
      (error: unknown) => { cleanup(); reject(error) },
    )
    controller.signal.addEventListener('abort', cleanup, { once: true })
  })
}

export async function readApiJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Сервер вернул HTTP ${response.status}`)
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) throw new Error('Сервер вернул неожиданный ответ')
  return await response.json() as T
}
