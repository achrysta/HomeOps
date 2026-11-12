import { describe, expect, it } from 'vitest'
import { progressAccess } from './progressAvailability'

describe('progress access', () => {
  it('does not display empty progress while the file is still loading', () => {
    expect(progressAccess('connecting', undefined, false, false)).toBe('loading')
    expect(progressAccess('connecting', undefined, false, true)).toBe('unavailable')
  })
  it('requires an explicit choice to open the cache when the initial read fails', () => {
    expect(progressAccess('offline', undefined, false, false)).toBe('unavailable')
    expect(progressAccess('offline', undefined, true, false)).toBe('content')
  })
  it('keeps loaded pages mounted during a temporary failure to save', () => {
    expect(progressAccess('offline', 'data/progress.json', false, false)).toBe('content')
    expect(progressAccess('saving', 'data/progress.json', false, true)).toBe('content')
    expect(progressAccess('synced', 'data/progress.json', false, false)).toBe('content')
  })
  it('does not allow edits through a file error, including after offline continuation', () => {
    expect(progressAccess('error', 'data/progress.json', true, false)).toBe('unavailable')
  })
})
