import { useEffect } from 'react'
import { examActive, examDeadline, examStands } from '../lib/ckaExam'
import { verifyExam } from '../lib/ckaExamActions'
import { beginExamOperation, endExamOperation } from '../lib/ckaExamRuntime'
import { requestReportsRefresh } from '../lib/labs'
import { useStore } from '../state/context'
import type { CkaExamAttempt } from '../types'

/** Таймер живёт в Layout: переход в другой раздел не отменяет автоматическую сдачу. */
export function CkaExamDeadline() {
  const { curriculum, progress, dispatch } = useStore()
  const attempt = progress.ckaExams?.findLast(examActive)
  useEffect(() => {
    if (!attempt?.startedAt || attempt.phase !== 'running' || attempt.autoSubmissionTried) return
    const submit = async () => {
      if (!beginExamOperation(attempt.id)) return
      const pending: CkaExamAttempt = { ...attempt, phase: 'checking', submittedAt: new Date().toISOString(), autoSubmissionTried: true, error: undefined }
      dispatch({ type: 'cka-exam/upsert', attempt: pending })
      try {
        const reports = await verifyExam(examStands(attempt.variantId, curriculum.incidents), attempt.startedAt!, () => {})
        dispatch({ type: 'cka-exam/upsert', attempt: { ...pending, phase: 'finished', finishedAt: new Date().toISOString(), reports } })
        requestReportsRefresh()
      } catch (error) {
        dispatch({ type: 'cka-exam/upsert', attempt: { ...pending, error: error instanceof Error ? error.message : 'Автоматическая сдача не завершена. Повторите проверку на странице экзамена.' } })
      } finally { endExamOperation(attempt.id) }
    }
    const timer = setTimeout(() => void submit(), Math.max(0, examDeadline(attempt) - Date.now()))
    return () => clearTimeout(timer)
  }, [attempt, curriculum.incidents, dispatch])
  return null
}
