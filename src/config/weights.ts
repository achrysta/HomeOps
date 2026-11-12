import type { Importance, InterviewRating, Level, Priority, TaskKind } from '../types'

/**
 * Веса задач в Learning Progress. Чтение документации почти ничего не стоит,
 * lab и production-like интеграции — основная часть прогресса.
 */
export const TASK_KIND_WEIGHT: Record<TaskKind, number> = {
  reading: 1,
  exercise: 2,
  lab: 4,
  integration: 6,
  quiz: 2,
}

/** Какой уровень навыка подтверждает задача данного типа (если не задан grantsLevel). */
export const TASK_KIND_LEVEL: Record<TaskKind, Level> = {
  reading: 1,
  exercise: 2,
  lab: 2,
  integration: 3,
  // сданная теория — это понимание, а не практический опыт
  quiz: 1,
}

/**
 * Уровень навыка из решённого стенда (skillIds инцидента). Самостоятельное решение — практика, как лабораторная;
 * решение после открытого разбора — как чтение. Учебный прогресс (доля задач) стенды не меняют.
 */
export const INCIDENT_LEVEL: { independent: Level; withDebrief: Level } = { independent: 2, withDebrief: 1 }

/**
 * Доля категории требований в Vacancy Match.
 * Bonus не может дать больше 8% итогового score, Advanced не влияет вовсе.
 * Доли нормализуются по категориям, присутствующим в профиле роли.
 */
export const IMPORTANCE_SHARE: Record<Importance, number> = {
  required: 0.7,
  important: 0.22,
  bonus: 0.08,
  advanced: 0,
}

/** Вес важности при выборе следующих действий (насколько закрытие gap ценно для роли). */
export const IMPORTANCE_ACTION_WEIGHT: Record<Importance, number> = {
  required: 6,
  important: 4,
  bonus: 1,
  advanced: 0,
}

export const PRIORITY_SCORE: Record<Priority, number> = {
  P0: 300,
  P1: 200,
  P2: 100,
  P3: 0,
}

/**
 * Штраф следующего шага за место трека в рекомендуемом порядке (Track.order), очков за позицию.
 * Пять позиций равны шагу приоритета: порядок треков влияет на выбор, но не перекрывает
 * приоритет задачи и разрыв навыков роли.
 */
export const TRACK_ORDER_PENALTY = 20

/** Шкала «Своими словами»; 3 — старая оценка «Покажу практический пример», читается как 2 (lib/interview). */
export const INTERVIEW_RATING_LABEL: Record<InterviewRating, string> = {
  0: 'Не могу ответить',
  1: 'Отвечу с подсказкой',
  2: 'Объясню самостоятельно',
  3: 'Объясню самостоятельно',
}

/** Проходной балл контрольного теста трека и сквозного экзамена. */
/** «Своими словами»: через сколько дней вопрос с такой оценкой снова стоит повторить */
export const INTERVIEW_REVIEW_DAYS: Record<InterviewRating, number> = { 0: 0, 1: 1, 2: 7, 3: 7 }
/** Проектирование: сколько символов своего ответа нужно, чтобы открыть разбор */
export const DESIGN_MIN_CHARS = 300
/** Сколько закладок «сохранить на потом» хранить */
export const MAX_SAVED = 500

/** Сколько календарных дней показывать в итогах на экране «Сегодня», включая текущий. */
export const TODAY_WINDOW_DAYS = 7

export const QUIZ_PASS_THRESHOLD = 0.8
/** Сколько случайных вопросов из банка трека попадает в одну попытку контрольного теста. */
export const QUIZ_SIZE = 20
/** Сколько случайных вопросов из каждого трека попадает в сквозной экзамен. */
export const FINAL_EXAM_PER_TRACK = 3
/** Сколько последних попыток хранить. */
export const MAX_QUIZ_ATTEMPTS = 30

/**
 * Интервальное повторение в тренажёре: через сколько дней после верного ответа вопрос снова
 * пора повторить, по длине серии верных ответов подряд (индекс = серия, последний — потолок).
 * После ошибки вопрос пора повторить сразу.
 */
export const REVIEW_INTERVAL_DAYS = [0, 1, 3, 7, 14, 30]

/** Залы: через сколько дней зал приходит снова после N-й завершённой сессии подряд (1, 3, 7, 14, 30) */
export const GYM_INTERVAL_DAYS = [1, 3, 7, 14, 30]
/** Сколько последних сессий зала хранить */
export const MAX_GYM_SESSIONS = 30
/** Как часто опрашивать живую проверку зала, мс */
export const GYM_POLL_MS = 3000
/** Как часто обновлять лёгкие проверки на странице запущенного инцидента, мс */
export const INCIDENT_LIVE_POLL_MS = 5000
/** Сколько ждать ответа сервиса стендов на запрос статуса: зависший сервис не должен держать вечный спиннер */
export const LABS_STATUS_TIMEOUT_MS = 8000
