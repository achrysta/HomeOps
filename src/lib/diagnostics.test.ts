import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'
import { DIAGNOSTIC_POLICY as P } from '../config/learning'
import { diagnosticCorrect, diagnosticPool, diagnosticRecommendations, nextDiagnosticQuestion, type DiagnosticAnswer } from './diagnostics'
import { createEmptyProgress } from './storage'

describe('read-only adaptive diagnostics',()=>{
  const role=curriculum.vacancies[0]
  const pool=diagnosticPool(curriculum,role)
  it('uses existing questions and known skills without accepting duplicate selections',()=>{
    expect(pool.length).toBeGreaterThan(P.maxQuestions)
    for(const q of pool){expect(curriculum.quizzes.some((quiz)=>quiz.questions.includes(q.question))).toBe(true);expect(q.skillIds.every((id)=>curriculum.skills.some((s)=>s.id===id))).toBe(true)}
    expect(diagnosticCorrect(pool[0].question,[pool[0].question.correct[0],pool[0].question.correct[0]])).toBe(false)
  })
  it('covers tracks first and asks more on weak responses, without repeats',()=>{
    const run=(weak:boolean)=>{const answers:DiagnosticAnswer[]=[];for(;;){const next=nextDiagnosticQuestion(pool,answers);if(!next)break;expect(answers.some((a)=>a.questionId===next.question.id)).toBe(false);answers.push({questionId:next.question.id,selection:weak?[]:next.question.correct,correct:!weak,confident:!weak})}return answers}
    const strong=run(false),weak=run(true)
    const tracks=new Set(pool.map((q)=>q.trackId)).size
    expect(strong).toHaveLength(P.minQuestions)
    expect(weak).toHaveLength(P.maxQuestions)
    expect(new Set(strong.slice(0,tracks).map((a)=>pool.find((q)=>q.question.id===a.questionId)!.trackId)).size).toBe(tracks)
  })
  it('reaches the role skills added with new tracks and prefers untested skills',()=>{
    for(const skill of ['agents','pipeline-orchestration','k8s-model-serving','gitops-delivery','fine-tuning'])
      expect(pool.filter((q)=>q.skillIds.includes(skill)).length,skill).toBeGreaterThanOrEqual(P.solidAnswers)
    const answers:DiagnosticAnswer[]=[]
    for(let next=nextDiagnosticQuestion(pool,answers);next;next=nextDiagnosticQuestion(pool,answers))answers.push({questionId:next.question.id,selection:[],correct:false,confident:false})
    const asked=new Set(answers.flatMap((a)=>pool.find((q)=>q.question.id===a.questionId)!.skillIds))
    for(const skill of ['agents','pipeline-orchestration','k8s-model-serving','gitops-delivery','fine-tuning'])expect(asked.has(skill),skill).toBe(true)
    const first=pool.find((q)=>q.trackId==='ml-lifecycle')!
    const second=nextDiagnosticQuestion(pool.filter((q)=>q.trackId==='ml-lifecycle'),[{questionId:first.question.id,selection:[],correct:true,confident:true}])!
    expect(second.skillIds.some((id)=>!first.skillIds.includes(id))).toBe(true)
  })
  it('never labels one lucky answer as knowledge or changes progress',()=>{
    const p=createEmptyProgress(curriculum)
    const before=JSON.stringify(p)
    const result=diagnosticRecommendations(curriculum,p,role,pool,[{questionId:pool[0].question.id,correct:true,confident:true,selection:pool[0].question.correct}])
    expect(result.knowledge.some((k)=>k.status==='solid')).toBe(false)
    expect(result.skim).toEqual([])
    expect(JSON.stringify(p)).toBe(before)
  })
})
