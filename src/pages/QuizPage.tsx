import { Lock, SearchX } from 'lucide-react'
import { QuizRunner } from '../components/QuizRunner'
import { EmptyState } from '../components/ui'
import { FINAL_EXAM_PER_TRACK, QUIZ_PASS_THRESHOLD, QUIZ_SIZE } from '../config/weights'
import { getTaskProgress } from '../lib/progress'
import { finalExamSize, hasPassed, sampleFinalExam, shuffle } from '../lib/quiz'
import { useStore } from '../state/context'
import { navigate, useRoute } from '../state/router'

export function QuizPage() {
  const { curriculum, idx, progress, dispatch } = useStore()
  const id = useRoute().params.get('id') ?? ''
  const back = () => navigate('tests')

  if (id === 'final') {
    const allPassed = curriculum.quizzes.every((q) =>
      hasPassed(getTaskProgress(progress, q.id).quizAttempts),
    )
    if (!allPassed)
      return (
        <EmptyState icon={<Lock size={22} />} title="Сквозной экзамен ещё закрыт">
          Сначала сдайте контрольные тесты всех треков.
        </EmptyState>
      )
    return (
      <QuizRunner
        key="final"
        title="Сквозной экзамен"
        description={`По ${FINAL_EXAM_PER_TRACK} случайных вопроса из каждого трека — каждый раз новый набор.`}
        threshold={QUIZ_PASS_THRESHOLD}
        expectedTotal={finalExamSize(curriculum.quizzes)}
        attempts={progress.finalExam}
        buildQuestions={() => sampleFinalExam(curriculum.quizzes, FINAL_EXAM_PER_TRACK)}
        onSubmit={(attempt, results) => {
          dispatch({ type: 'exam/attempt', attempt })
          dispatch({ type: 'practice/record', results })
        }}
        onBack={back}
        backLabel="К списку тестов"
      />
    )
  }

  const quiz = curriculum.quizzes.find((q) => q.id === id)
  const task = idx.taskById.get(id)
  if (!quiz || !task) return <EmptyState icon={<SearchX size={22} />} title="Тест не найден" />
  const unlocks = (idx.dependents.get(id) ?? [])
    .map((d) => `${d} · ${idx.taskById.get(d)?.title}`)
    .join('; ')

  return (
    <QuizRunner
      key={id}
      title={task.title}
      description={`${Math.min(QUIZ_SIZE, quiz.questions.length)} случайных вопросов из банка трека (${quiz.questions.length}). ${task.description}`}
      threshold={QUIZ_PASS_THRESHOLD}
      expectedTotal={QUIZ_SIZE}
      attempts={getTaskProgress(progress, id).quizAttempts ?? []}
      buildQuestions={() => shuffle(quiz.questions).slice(0, QUIZ_SIZE)}
      onSubmit={(attempt, results) => {
        dispatch({ type: 'quiz/attempt', id, attempt })
        dispatch({ type: 'practice/record', results })
      }}
      onBack={back}
      backLabel="К списку тестов"
      unlocks={unlocks || undefined}
    />
  )
}
