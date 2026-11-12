import type { SyncMode } from './sync'

export function progressAccess(mode: SyncMode, file: string | undefined, continuedOffline: boolean, delayed: boolean): 'loading' | 'unavailable' | 'content' {
  if (mode === 'connecting') return delayed ? 'unavailable' : 'loading'
  if (mode === 'error') return 'unavailable'
  if (mode === 'offline' && !file && !continuedOffline) return 'unavailable'
  return 'content'
}
