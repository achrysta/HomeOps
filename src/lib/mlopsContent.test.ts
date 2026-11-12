import { describe, expect, it } from 'vitest'
import { pack } from '../data/packs/finetuning/pack'
import { quizzes } from '../data/packs/finetuning/quiz'
import { checks, steps } from '../data/packs/finetuning/steps'
import { mlServing } from '../data/drills/ml-serving'
import { mlGpu } from '../data/drills/ml-gpu'
import { mlFinetune } from '../data/drills/ml-finetune'
import { curriculum } from '../data'

const banks = [mlServing, mlGpu, mlFinetune]
describe('MLOps content package', () => {
  it('registers J with a quiz gate, CPU alternative and explicit NVIDIA practice', () => {
    const order = (id: string) => curriculum.tracks.find((t) => t.id === id)!.order
    expect(curriculum.tracks.find((t) => t.id === 'finetuning')).toMatchObject({ code: 'J', kind: 'core' })
    // J опирается на B, C и F: в рекомендуемом порядке идёт после них
    for (const id of ['ml-lifecycle', 'llm-serving', 'llm-eval']) expect(order('finetuning'), id).toBeGreaterThan(order(id))
    expect(pack.requirements).toContainEqual(expect.objectContaining({ skillId: 'fine-tuning', importance: 'important', targetLevel: 2 }))
    const tasks = pack.tasks!
    for (const id of ['J1.1', 'J2']) expect(tasks.find((t) => t.id === id)?.prerequisites).toContain('JQ')
    expect(tasks.find((t) => t.id === 'J1.1')?.environmentDependency).not.toBe(true)
    for (const id of ['J2', 'J4']) expect(tasks.find((t) => t.id === id)?.environmentDependency).toBe(true)
    for (const task of tasks.filter((t) => ['exercise', 'lab', 'integration'].includes(t.kind))) {
      expect(steps[task.id]?.length, task.id).toBeGreaterThanOrEqual(4)
      expect(checks[task.id]?.length, task.id).toBe(steps[task.id].length)
      expect(task.resourceIds.some((id) => pack.resources?.some((r) => r.id === id && r.language === 'ru')), task.id).toBe(true)
    }
    expect(pack.interviewTopics?.[0].questions).toHaveLength(10)
    // Loader-fixture не изображает опыт обучения или подготовки данных.
    expect(pack.interviewTopics?.[0].incidentIds).toEqual([])
  })

  it.each([...banks, { id: 'JQ', questions: quizzes[0].questions }])('$id has useful explanations and no answer-length shortcut', (bank) => {
    expect(bank.questions.length).toBeGreaterThanOrEqual(bank.id === 'JQ' ? 36 : 40)
    let shortest = 0
    let longest = 0
    for (const question of bank.questions) {
      const right = question.options[question.correct[0]].length
      const wrong = question.options.filter((_, i) => !question.correct.includes(i)).map((o) => o.length)
      expect(right, question.id).toBeLessThanOrEqual(Math.max(...wrong) * 1.3)
      if (right <= Math.min(...wrong)) shortest++
      if (right >= Math.max(...wrong)) longest++
      question.options.forEach((_, i) => expect(question.correct.includes(i) ? question.optionNotes?.[i] === '' : (question.optionNotes?.[i]?.length ?? 0) > 20, question.id).toBe(true))
    }
    expect(shortest / bank.questions.length).toBeLessThanOrEqual(0.35)
    expect(longest / bank.questions.length).toBeLessThanOrEqual(0.35)
  })

  it('registers all three read-only banks with terminal-output questions', () => {
    for (const bank of banks) {
      expect(curriculum.drills.find((d) => d.id === bank.id)).toBe(bank)
      expect(bank.area).toBe('ml')
      expect(bank.questions.some((q) => q.output)).toBe(true)
      expect(bank.questions.every((q) => q.id.startsWith(`${bank.id}-`))).toBe(true)
    }
  })
})
