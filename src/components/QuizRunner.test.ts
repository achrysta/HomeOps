import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QuizRunner } from './QuizRunner'
describe('review: quiz status uses the complete score, not a saved flag', () => {
  const render = (correct: number, total: number, passed: boolean) =>
    renderToStaticMarkup(
      createElement(QuizRunner, {
        title: 'Тест',
        description: '',
        threshold: 0.8,
        expectedTotal: 20,
        attempts: [{ id: 'a', at: '2026-10-08', correct, total, passed, wrongIds: [] }],
        buildQuestions: () => [],
        onSubmit: () => {},
        onBack: () => {},
        backLabel: 'Назад',
      }),
    )
  it('displays an incomplete or low-scoring forged pass as not passed', () => {
    expect(render(1, 1, true)).toContain('Не сдан')
    expect(render(1, 20, true)).toContain('Не сдан')
    expect(render(16, 20, false)).toContain('Сдан')
  })
})
