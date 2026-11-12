import { afterEach, describe, expect, it, vi } from 'vitest'
import { curriculum } from '../data'
import { cheatsheets } from '../data/cheatsheets'
import { taskEstimates } from '../data/taskEstimates'
import { trackALesson } from '../data/trackALesson'
import { reducer } from '../state/reducer'
import { createEmptyProgress, normalizeProgress } from './storage'
import { elapsedMinutes, normalizeTiming, trackTime } from './timing'
import { normalizeMeasurement } from './measurements'
import { getVerification, summarize } from './progress'

afterEach(()=>vi.useRealTimers())
const sample={id:'m',taskId:'A1',date:'2026-10-09',metric:'ttft' as const,value:180,unit:'мс',model:'Qwen 1.5B BF16',hardware:'RTX 4060 8 ГБ',conditions:'12 RPS, 128/64 tokens, тёплый запуск, p95'}

describe('batch 4 learning records',()=>{
  it('links every cheatsheet to existing practical content and estimates every current task',()=>{
    for(const s of cheatsheets){expect(s.minutes).toBe(10);expect(s.sections.length).toBeGreaterThanOrEqual(4);for(const p of s.practice){const ids=p.kind==='task'?curriculum.tasks:p.kind==='gym'?curriculum.gyms:p.kind==='incident'?curriculum.incidents:curriculum.exercises.flatMap((e)=>e.exercises);expect(ids.some((i)=>i.id===p.id),`${s.id}: ${p.kind} ${p.id}`).toBe(true)}}
    for(const t of curriculum.tasks){expect(taskEstimates[t.id],t.id).toBeDefined();expect(taskEstimates[t.id].minMinutes).toBeGreaterThan(0);expect(taskEstimates[t.id].maxMinutes).toBeGreaterThanOrEqual(taskEstimates[t.id].minMinutes)}
    for(const section of trackALesson.sections) for(const id of section.taskIds) expect(curriculum.tasks.some((t)=>t.id===id),`Конспект A: ${id}`).toBe(true)
  })
  it('starts timing once and ends it only at actual verification, preserving the first result',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-09T10:00:00Z'))
    const t=curriculum.tasks.find((t)=>t.id==='A1')!
    let p=reducer(createEmptyProgress(curriculum),{type:'task/status',id:t.id,status:'in_progress'})
    const start=p.tasks[t.id].timing!.startedAt
    vi.setSystemTime(new Date('2026-10-09T11:00:00Z'))
    p=reducer(p,{type:'task/status',id:t.id,status:'completed'})
    expect(p.tasks[t.id].timing!.firstVerifiedAt).toBeUndefined()
    for(const criterion of t.acceptanceCriteria)p=reducer(p,{type:'task/criterion',id:t.id,criterion,done:true})
    expect(p.tasks[t.id].timing!.firstVerifiedAt).toBeUndefined()
    p=reducer(p,{type:'task/evidence/add',id:t.id,evidence:{type:'note',value:'Вывод проверки'}})
    expect(elapsedMinutes(p.tasks[t.id].timing)).toBe(60)
    const end=p.tasks[t.id].timing!.firstVerifiedAt
    p=reducer(p,{type:'task/criterion',id:t.id,criterion:t.acceptanceCriteria[0],done:false})
    vi.setSystemTime(new Date('2026-10-10T10:00:00Z'))
    p=reducer(p,{type:'task/status',id:t.id,status:'in_progress'})
    expect(p.tasks[t.id].timing).toEqual({startedAt:start,firstVerifiedAt:end})
    expect(trackTime([t],p).measured).toBe(0)
  })
  it('does not backfill old starts or stop time on a forged manual quiz status',()=>{
    const p=createEmptyProgress(curriculum)
    const t=curriculum.tasks.find((t)=>t.kind==='lab')!
    const old={status:'completed' as const,criteriaDone:t.acceptanceCriteria,evidence:[{id:'e',type:'note' as const,value:'Пример',createdAt:p.meta.createdAt}],notes:''}
    const imported=normalizeProgress({...p,tasks:{[t.id]:old}},curriculum)
    expect(imported.tasks[t.id].timing).toBeUndefined()
    expect(reducer(imported,{type:'task/notes',id:t.id,notes:'Новая заметка'}).tasks[t.id].timing).toBeUndefined()
    const q=curriculum.tasks.find((t)=>t.kind==='quiz')!
    const started=reducer(p,{type:'task/status',id:q.id,status:'in_progress'})
    const finished=reducer(started,{type:'task/status',id:q.id,status:'completed'})
    expect(getVerification(q,finished.tasks[q.id])).toBe('open')
    expect(finished.tasks[q.id].timing?.firstVerifiedAt).toBeUndefined()
    expect(normalizeTiming({startedAt:'bad'})).toBeUndefined()
    expect(normalizeTiming({startedAt:'2026-10-09',firstVerifiedAt:'2026-10-08'})).toEqual({startedAt:'2026-10-09'})
  })
  it('normalizes records without creating defaults in old progress or rewriting valid values',()=>{
    const p=createEmptyProgress(curriculum)
    expect(normalizeProgress(p,curriculum)).not.toHaveProperty('measurements')
    const raw={...p,measurements:[sample]}
    const n=normalizeProgress(raw,curriculum)
    expect(n.measurements).toEqual(raw.measurements)
    expect(normalizeMeasurement({...sample,date:'2026-99-10'})).toBeNull()
    expect(normalizeMeasurement({...sample,metric:'recall',unit:'доля',value:1.2})).toBeNull()
    expect(normalizeMeasurement({...sample,value:NaN})).toBeNull()
  })
  it('records measurements without changing verification or learning progress',()=>{
    const p=createEmptyProgress(curriculum)
    const next=reducer(p,{type:'measurement/upsert',measurement:sample})
    expect(next.measurements).toHaveLength(1)
    expect(next.tasks).toBe(p.tasks);expect(next.skills).toBe(p.skills);expect(next.incidents).toBe(p.incidents)
    expect(summarize(curriculum.tasks,next)).toEqual(summarize(curriculum.tasks,p))
  })
})
