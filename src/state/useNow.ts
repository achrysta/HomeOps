import { useSyncExternalStore } from 'react'

// Текущее время для расчётов в рендере (сроки повторения): обновляется раз в минуту,
// пока есть подписчики. Date.now() прямо в рендере делал бы компонент нечистым.
const TICK_MS = 60_000
let now = Date.now()
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()

/** После новой записи практики обновляем часы сразу, иначе её дата до минуты была бы «в будущем». */
export function refreshNow(): void {
  now = Date.now()
  listeners.forEach((listener) => listener())
}

function subscribe(cb: () => void): () => void {
  if (!listeners.size) {
    now = Date.now()
    timer = setInterval(refreshNow, TICK_MS)
  }
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
    if (!listeners.size) clearInterval(timer)
  }
}

export const useNow = (): number => useSyncExternalStore(subscribe, () => now)
