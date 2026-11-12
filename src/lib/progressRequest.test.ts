import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROGRESS_REQUEST_TIMEOUT_MS } from '../config/learning'
import { progressRequest } from './progressRequest'
import { createEmptyProgress } from './storage'
import { curriculum } from '../data'

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.resetModules()})
describe('progress request deadlines',()=>{
  it('releases a transport that ignores abort and aborts the real request',async()=>{vi.useFakeTimers();let signal:AbortSignal|undefined;vi.stubGlobal('fetch',vi.fn((_input,init)=>{signal=init.signal;return new Promise(()=>{})}));const promise=progressRequest('/api/progress',undefined,(r)=>r.json());await vi.advanceTimersByTimeAsync(PROGRESS_REQUEST_TIMEOUT_MS);expect(await promise).toBeNull();expect(signal?.aborted).toBe(true)})
  it('covers a hanging response body as well as headers',async()=>{vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn(async()=>({json:()=>new Promise(()=>{})})));const promise=progressRequest('/api/progress',undefined,(r)=>r.json());await vi.advanceTimersByTimeAsync(PROGRESS_REQUEST_TIMEOUT_MS);expect(await promise).toBeNull()})
  it('leaves saving state on timeout and can retry without losing queued edits',async()=>{
    vi.useFakeTimers();vi.resetModules();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}})
    let hang=false
    const fetch=vi.fn(async(_url,init)=>hang?new Promise(()=>{}):{headers:new Headers({'Content-Type':'application/json'}),status:init?.method==='PUT'?200:404,json:async()=>init?.method==='PUT'?{revision:1,savedAt:new Date().toISOString()}:{file:'test/progress.json'}})
    vi.stubGlobal('fetch',fetch)
    const sync=await import('./sync')
    const p=createEmptyProgress(curriculum)
    sync.queueSave(p);await sync.initSync(curriculum,()=>{});await vi.advanceTimersByTimeAsync(0)
    expect(sync.getSyncStatus().mode).toBe('synced')
    hang=true;sync.queueSave({...p,journal:[{id:'j',date:'2026-10-09',did:'Реальная запись',learned:'',unclear:'',evidenceUrl:''}]})
    await vi.advanceTimersByTimeAsync(400)
    expect(sync.getSyncStatus().mode).toBe('saving')
    await vi.advanceTimersByTimeAsync(PROGRESS_REQUEST_TIMEOUT_MS)
    expect(sync.getSyncStatus().mode).toBe('offline')
    hang=false;await vi.advanceTimersByTimeAsync(15_000)
    expect(sync.getSyncStatus().mode).toBe('synced')
    const last=JSON.parse(fetch.mock.calls.at(-1)![1].body)
    expect(last.progress.journal[0].did).toBe('Реальная запись')
  })
})
