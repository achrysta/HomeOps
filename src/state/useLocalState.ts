import { useEffect, useState } from 'react'

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Значение из localStorage поверх начального: у объектов недостающие поля берутся из initial
 * (новые настройки после обновления), простые значения и массивы — как есть, если тип совпадает.
 */
export function restoreLocalValue<T>(initial: T, raw: string | null): T {
  if (!raw) return initial
  const parsed: unknown = JSON.parse(raw)
  if (isPlainObject(initial)) return isPlainObject(parsed) ? ({ ...initial, ...parsed } as T) : initial
  if (Array.isArray(initial)) return Array.isArray(parsed) ? (parsed as T) : initial
  return typeof parsed === typeof initial ? (parsed as T) : initial
}

/** Per-viewer UI-состояние (фильтры, свёрнутые блоки, режимы). Не часть экспортируемого прогресса. */
export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return restoreLocalValue(initial, localStorage.getItem(`homeops.ui.${key}`))
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(`homeops.ui.${key}`, JSON.stringify(value))
    } catch {
      // storage недоступен — состояние живёт только в памяти
    }
  }, [key, value])
  return [value, setValue]
}
