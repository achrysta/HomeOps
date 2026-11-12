import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchLabsStatus, nextLabsStatus, type LabsStatus } from '../lib/labs'

/** Состояние сервиса стендов: опрашивается, пока страница открыта и видна. undefined — загружается, null — сервис недоступен. */
export function useLabsStatus(intervalMs: number): [LabsStatus | null | undefined, () => void] {
  const [labs, setLabs] = useState<LabsStatus | null | undefined>(undefined)
  // последний показанный статус и число медленных ответов подряд — в ref, вне функции обновления состояния
  const shown = useRef<LabsStatus | null | undefined>(undefined)
  const timeouts = useRef(0)
  const refresh = useCallback(() => {
    void fetchLabsStatus().then((next) => {
      const r = nextLabsStatus(shown.current, next, timeouts.current)
      timeouts.current = r.timeouts
      shown.current = r.status
      setLabs(r.status)
    })
  }, [])
  useEffect(() => {
    const first = setTimeout(refresh, 0)
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(), intervalMs)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [refresh, intervalMs])
  return [labs, refresh]
}
