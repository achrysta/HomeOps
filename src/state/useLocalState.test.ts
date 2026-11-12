import { describe, expect, it } from 'vitest'
import { restoreLocalValue } from './useLocalState'

describe('local UI state', () => {
  it('fills missing object fields from the initial value', () => {
    expect(restoreLocalValue({ a: 1, b: 2 }, '{"a":5}')).toEqual({ a: 5, b: 2 })
    expect(restoreLocalValue({ a: 1 }, '"text"')).toEqual({ a: 1 })
  })

  it('restores strings, numbers and arrays as they are', () => {
    // раньше строка разворачивалась в объект {0: 'm', 1: 'o', …}
    expect(restoreLocalValue<'topics' | 'mock'>('topics', '"mock"')).toBe('mock')
    expect(restoreLocalValue(10, '25')).toBe(25)
    expect(restoreLocalValue(10, '"x"')).toBe(10)
    expect(restoreLocalValue<string[]>([], '["a"]')).toEqual(['a'])
    expect(restoreLocalValue('topics', null)).toBe('topics')
  })
})
