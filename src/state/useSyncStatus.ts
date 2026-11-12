import { useSyncExternalStore } from 'react'
import { getSyncStatus, subscribeSync, type SyncStatus } from '../lib/sync'

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSync, getSyncStatus)
}
