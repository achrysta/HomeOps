import type { Curriculum, Resource, Skill, TaskDef, UserProgress } from '../types'

export interface NoteHit {
  kind: 'task-note' | 'evidence' | 'interview' | 'design' | 'skill-note'
  title: string
  snippet: string
  taskId?: string
  topicId?: string
  designId?: string
  skillId?: string
}

/** Практика и вопросы программы. Ищем только по тому, что не раскрывает решения: без подсказок, разборов и тезисов. */
export interface ProgramHit {
  kind: 'incident' | 'gym' | 'question'
  title: string
  snippet: string
  page: 'incidents' | 'gyms' | 'interview'
  params: Record<string, string>
}

export interface SearchResults {
  skills: Skill[]
  tasks: TaskDef[]
  resources: Resource[]
  program: ProgramHit[]
  notes: NoteHit[]
  total: number
}

function snippet(text: string, q: string, radius = 70): string {
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return text.slice(0, radius * 2)
  const start = Math.max(0, i - radius)
  const end = Math.min(text.length, i + q.length + radius)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/** Регистронезависимый поиск по всем словам запроса (AND). */
function matches(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase()
  return terms.every((t) => lower.includes(t))
}

export function search(query: string, c: Curriculum, p: UserProgress): SearchResults {
  const q = query.trim().toLowerCase()
  const empty: SearchResults = { skills: [], tasks: [], resources: [], program: [], notes: [], total: 0 }
  if (q.length < 2) return empty
  const terms = q.split(/\s+/).filter(Boolean)

  const skills = c.skills.filter((s) => matches(`${s.id} ${s.title} ${s.description}`, terms))
  const tasks = c.tasks.filter((t) =>
    matches(`${t.id} ${t.title} ${t.description} ${t.tags.join(' ')} ${t.acceptanceCriteria.join(' ')}`, terms),
  )
  const resources = c.resources.filter((r) => matches(`${r.title} ${r.ru?.title ?? ''} ${r.url} ${r.note ?? ''} ${r.type}`, terms))

  const program: ProgramHit[] = []
  for (const d of c.incidents) {
    const text = `${d.title}\n${d.scenario}\n${d.goal}\n${d.stack.join('\n')}`
    if (matches(text, terms)) program.push({ kind: 'incident', title: d.title, snippet: snippet(text, terms[0]), page: 'incidents', params: { id: d.id } })
  }
  for (const g of c.gyms) {
    const text = `${g.title}\n${g.description}\n${g.reps.map((r) => `${r.title}: ${r.task}`).join('\n')}`
    if (matches(text, terms)) program.push({ kind: 'gym', title: g.title, snippet: snippet(text, terms[0]), page: 'gyms', params: { id: g.id } })
  }
  for (const topic of c.interviewTopics) {
    for (const question of topic.questions) {
      if (matches(question.text, terms)) program.push({ kind: 'question', title: question.text, snippet: topic.title, page: 'interview', params: { view: 'topics', q: question.id } })
    }
  }

  const notes: NoteHit[] = []
  const taskTitle = (id: string) => c.tasks.find((t) => t.id === id)?.title ?? id
  for (const [taskId, tp] of Object.entries(p.tasks)) {
    if (tp.notes && matches(tp.notes, terms)) {
      notes.push({ kind: 'task-note', title: `${taskId} · ${taskTitle(taskId)}`, snippet: snippet(tp.notes, terms[0]), taskId })
    }
    for (const ev of tp.evidence) {
      const text = `${ev.value} ${ev.description ?? ''}`
      if (matches(text, terms)) notes.push({ kind: 'evidence', title: `Подтверждение · ${taskId}`, snippet: snippet(text, terms[0]), taskId })
    }
  }
  for (const topic of c.interviewTopics) {
    for (const question of topic.questions) {
      const note = p.interview.answers[question.id]?.note
      if (note && matches(note, terms)) notes.push({ kind: 'interview', title: question.text, snippet: snippet(note, terms[0]), topicId: topic.id })
    }
  }
  for (const d of c.designCases) {
    const text = p.interview.designs[d.id]?.text
    if (text && matches(text, terms)) notes.push({ kind: 'design', title: `Проектирование · ${d.title}`, snippet: snippet(text, terms[0]), designId: d.id })
  }
  for (const [skillId, sp] of Object.entries(p.skills)) {
    if (sp.note && matches(sp.note, terms)) {
      notes.push({ kind: 'skill-note', title: c.skills.find((s) => s.id === skillId)?.title ?? skillId, snippet: snippet(sp.note, terms[0]), skillId })
    }
  }

  return { skills, tasks, resources, program, notes, total: skills.length + tasks.length + resources.length + program.length + notes.length }
}
