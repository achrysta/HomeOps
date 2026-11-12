// Контрольные тесты пакетов контента (см. ./index.ts). Отдельный модуль — чанк track-quizzes.
import type { Quiz } from '../../types'
import { quizzes as finetuning } from './finetuning/quiz'
import { quizzes as agents } from './agents/quiz'
import { quizzes as platformIac } from './platform-iac/quiz'

export const packQuizzes: Quiz[] = [...agents, ...finetuning, ...platformIac]
