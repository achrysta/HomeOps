// ─────────────────────────────────────────────────────────────────────────────
// Curriculum (seed) — неизменяемые данные, поставляются с приложением.
// User progress хранится отдельно и ссылается на сущности curriculum по id,
// поэтому roadmap можно обновлять без потери прогресса.
// ─────────────────────────────────────────────────────────────────────────────

/** 0 — нет опыта, 1 — базовое понимание, 2 — делал локально,
 *  3 — применял в production-like проекте, 4 — production experience */
export type Level = 0 | 1 | 2 | 3 | 4

export type Importance = 'required' | 'important' | 'bonus' | 'advanced'
export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked'
export type Priority = 'P0' | 'P1' | 'P2' | 'P3'
/** Тип задачи определяет её вес в Learning Progress и уровень навыка, который она подтверждает. */
export type TaskKind = 'reading' | 'exercise' | 'lab' | 'integration' | 'quiz'
export type ResourceType = 'docs' | 'video' | 'book' | 'article' | 'lab'
export type EvidenceType = 'commit' | 'repo' | 'screenshot' | 'url' | 'note'
export type TrackKind = 'core' | 'fundamentals' | 'advanced'

export interface Resource {
  id: string
  title: string
  type: ResourceType
  url: string
  language: 'en' | 'ru'
  note?: string
  /** Официальный русский перевод того же материала: показывается основной ссылкой, оригинал — рядом. */
  ru?: { url: string; title?: string }
}

/** Навык из общего каталога требований. Один навык может входить в несколько вакансий
 *  с разной важностью и целевым уровнем. */
export interface Skill {
  id: string
  title: string
  description: string
  /** Стартовый уровень из профиля пользователя (самооценка с обоснованием). */
  baselineLevel: Level
  baselineEvidence?: string
}

export interface VacancyRequirement {
  skillId: string
  importance: Importance
  targetLevel: Level
  /** Короткое пояснение, как требование звучит в контексте вакансии. */
  summary: string
}

export interface Vacancy {
  id: string
  /** Компания — только для профиля конкретной вакансии. У обобщённой роли не задаётся. */
  company?: string
  /** Вакансии, по которым собран профиль требований (для справки) */
  sources?: string[]
  title: string
  summary: string
  /** Компоненты AI-платформы, которые уже работают в production. */
  platform: string[]
  responsibilities: string[]
  requirements: VacancyRequirement[]
}

export interface Track {
  id: string
  code: string
  title: string
  goal: string
  /** Короткая рабочая проблема, которую решает трек; не меняет зависимости задач. */
  workProblem?: string
  /** Входные знания и окружение — пояснение для карты, не ключи прогресса. */
  entryRequirements?: string[]
  /** Короткий итог засчитанного трека — описательный текст, без записи в прогресс. */
  learned?: string[]
  nextSteps?: string[]
  kind: TrackKind
  order: number
  topics: string[]
  acceptanceCriteria: string[]
  note?: string
}

export interface TaskDef {
  id: string
  trackId: string
  title: string
  description: string
  kind: TaskKind
  priority: Priority
  prerequisites: string[]
  resourceIds: string[]
  acceptanceCriteria: string[]
  tags: string[]
  /** id навыков из каталога (skills). Связь с вакансией идёт через Vacancy.requirements. */
  vacancyRequirementIds: string[]
  /** Lab зависит от окружения (GPU, WSL, Kubernetes с GPU). Не блокирует roadmap. */
  environmentDependency: boolean
  /** Необязательная задача: не входит в знаменатель Learning Progress. */
  optional?: boolean
  /** Пошаговый план «Что сделать» (src/data/labSteps.ts) */
  steps?: string[]
  /** Уровень навыка, который подтверждает задача. По умолчанию — по kind (см. config/weights). */
  grantsLevel?: Level
}

export interface QuizQuestion {
  id: string
  text: string
  options: string[]
  /** Индексы правильных вариантов. Больше одного — вопрос с несколькими ответами. */
  correct: number[]
  explanation: string
  /** Почему ошибочен именно этот вариант (по индексам options; у правильных — пустая строка) */
  optionNotes?: string[]
  /** Вывод терминала или сообщение коллеги к вопросу «что случилось?» — показывается моноширинно под текстом */
  output?: string
  /** Домен CKA (банк «Kubernetes» DevOps-базы) — для тренировки по доменам */
  cka?: CkaDomain
}

/** Контрольный тест трека. id совпадает с id задачи kind: 'quiz'. */
export interface Quiz {
  id: string
  trackId: string
  questions: QuizQuestion[]
}

/** Банк вопросов для повторения в тренажёре (DevOps-база, MLOps-база). Не влияет на прогресс и соответствие роли. */
/** Раздел банков: инфраструктура и данные — DevOps-база, ml — MLOps-база (группировка тем в тренажёре) */
export type DrillArea = 'infra' | 'data' | 'ml'
/** Группа банков повторения в тренажёре */
export type DrillGroup = 'mlops' | 'devops'

export interface Drill {
  id: string
  title: string
  area: DrillArea
  description: string
  questions: QuizQuestion[]
}

/**
 * Упражнение тренажёра другого формата, чем выбор варианта. Статистика и повторение — как у вопросов
 * (progress.practice по id), на прогресс обучения и соответствие роли не влияет.
 *  - order — расставить шаги по порядку (steps — в правильном порядке, показываются перемешанными);
 *  - match — сопоставить левое с правым (pairs — верные пары, extra — лишние варианты справа);
 *  - error — найти строки с ошибкой (lines — фрагмент кода или конфига, errors — индексы строк, fix — как правильно);
 *  - arch — собрать архитектуру: разложить блоки по слоям, лишние отметить «не нужен» (тренировка к system design).
 */
export type Exercise =
  | { kind: 'order'; id: string; text: string; steps: string[]; explanation: string }
  | { kind: 'match'; id: string; text: string; pairs: [string, string][]; extra?: string[]; explanation: string }
  | { kind: 'error'; id: string; text: string; lines: string[]; errors: number[]; fix: string; explanation: string }
  /** Собрать архитектуру: разложить блоки по слоям (zones); zone: null — лишний блок, note — почему он здесь или почему лишний */
  | { kind: 'arch'; id: string; text: string; zones: string[]; blocks: { title: string; zone: number | null; note: string }[]; explanation: string }

export interface ExerciseSet {
  id: string
  title: string
  description: string
  exercises: Exercise[]
}

/**
 * Зал: короткие подходы в терминале стенда вокруг одной команды или понятия. Подход засчитывается сам —
 * по живой проверке состояния (verify --live), без кнопки. Залы не входят в прогресс обучения
 * и соответствие роли, как и тренажёр: это тренировка беглости, а не подтверждение навыка.
 */
export interface GymRep {
  /** = id живой проверки в incidents/<зал>/checks.py */
  id: string
  title: string
  /** Что сделать: результат, а не готовая команда */
  task: string
  /** Подсказка: нужная команда или флаг — открывается по кнопке */
  hint: string
}

export interface GymDef {
  /** = папка incidents/<id> */
  id: string
  title: string
  topic: 'Kubernetes' | 'Linux' | 'MLflow' | 'Airflow' | 'LLM API'
  cka?: CkaDomain[]
  description: string
  /** Сколько минут на сессию при беглом выполнении */
  minutes: number
  /** Где работать: namespace или сервер — показывается над подходами */
  where: string
  reps: GymRep[]
}

export interface GymSession {
  id: string
  startedAt: string
  finishedAt?: string
  /** repId → когда подход засчитан */
  reps: Record<string, string>
}

export interface GymProgress {
  sessions: GymSession[]
  /** Пауза: зал не приходит по расписанию */
  paused?: boolean
}

export interface InterviewQuestion {
  id: string
  text: string
  /** Ключевые тезисы: что должно прозвучать в ответе (3–5 пунктов). Показываются после самооценки */
  points: string[]
  /** Типичная ошибка в ответе */
  pitfall: string
  /**
   * Навыки роли, которые проверяет вопрос (подмножество навыков темы). Не задан — все навыки темы;
   * в теме с несколькими навыками задаётся у каждого вопроса (тест): по нему считается покрытие требований роли.
   */
  skillIds?: string[]
}

export interface InterviewTopic {
  id: string
  title: string
  /** mlops — темы треков ML/AI-платформы; devops — платформенная и DevOps-база */
  group: 'mlops' | 'devops'
  trackIds: string[]
  skillIds: string[]
  /** Стенды по теме: где те же знания отрабатываются на практике */
  incidentIds: string[]
  questions: InterviewQuestion[]
}

/** Аспект разбора кейса проектирования: по нему сверяют свой ответ */
export interface DesignAspect {
  id: string
  title: string
  /** Контрольный вопрос, если аспект не прозвучал в ответе */
  question: string
}

/** Кейс проектирования: условие, вводные и разбор-ориентир по аспектам */
export interface DesignCase {
  id: string
  title: string
  brief: string
  /** Вводные: нагрузка, SLO, ограничения */
  givens: string[]
  skillIds: string[]
  incidentIds: string[]
  /** aspectId → тезисы разбора-ориентира */
  outline: Record<string, string[]>
  pitfalls: string[]
  /** Упражнение «Собери архитектуру» по этому кейсу — предлагается после сверки с разбором */
  exerciseId?: string
}

/** Уровень инцидента: старт — одна поломка с подсказками в логах, практика — 2–3 слоя, вызов — нужна самостоятельная оценка компромиссов. */
export type IncidentLevel = 'start' | 'practice' | 'challenge'

export interface IncidentCheckDef {
  /** Совпадает с id в incidents/<id>/checks.py */
  id: string
  title: string
}

/** Учебный инцидент: сломанный стенд в docker compose (папка incidents/<id>) с автопроверкой. */
/** Домены программы CKA (cncf/curriculum, v1.35) */
export type CkaDomain = 'troubleshooting' | 'cluster' | 'networking' | 'workloads' | 'storage'

export interface IncidentDef {
  id: string
  title: string
  /** Аппаратный CUDA-стенд; CPU/Metal не заменяют NVIDIA в Docker. */
  requires?: 'nvidia-gpu'
  /** mlops — инциденты треков ML/AI-платформы; devops — платформенная и DevOps-база */
  category: 'mlops' | 'devops'
  /** Трек программы (для category: 'mlops') */
  trackId?: string
  /** Инцидент на учебном Linux-сервере: терминал и проверка работают внутри сервера */
  server?: boolean
  /** Стенд в общем Kubernetes-кластере (kind): терминал с kubectl, проверка через API кластера */
  cluster?: boolean
  /**
   * Стенд уровня кластера (homeops.cluster: exclusive): ломает узлы или control plane, работает один на свежем
   * кластере, терминал открывается и в узлах kind; сброс и остановка пересоздают или удаляют кластер
   */
  nodeAccess?: boolean
  /** Домены экзамена CKA, которые тренирует инцидент */
  cka?: CkaDomain[]
  /** Тема DevOps-базы для подписи в списке (Linux, Docker…) */
  topic?: string
  level: IncidentLevel
  minutes: number
  /** Классическая поломка, которую стоит уметь разобрать (подпись «Классика») */
  interview?: boolean
  /** У стенда нет постоянно работающих сервисов: всё запускается по команде (pipeline, скрипты) */
  onDemand?: boolean
  /** Как инцидент выглядит для пользователей и дежурного — без причины */
  scenario: string
  /** Итоговое состояние, которое проверяет автопроверка */
  goal: string
  /** Ограничения условия: чего нельзя делать при исправлении. Каждое ловит автопроверка — иначе это обещание без проверки */
  constraints?: string[]
  /** Что развёрнуто в стенде */
  stack: string[]
  /** Адреса на хосте, которые полезно открыть */
  links?: { label: string; url: string }[]
  /** Что скачивается при первом запуске */
  download?: string
  /** Подсказки по возрастанию конкретности: направление, а не решение */
  hints: string[]
  checks: IncidentCheckDef[]
  debrief: { cause: string; fix: string; lesson: string }
  skillIds: string[]
  relatedTaskIds: string[]
}

export interface Curriculum {
  version: string
  skills: Skill[]
  tracks: Track[]
  tasks: TaskDef[]
  resources: Resource[]
  interviewTopics: InterviewTopic[]
  /** Проектирование (system design): аспекты оценки и кейсы */
  designAspects: DesignAspect[]
  designCases: DesignCase[]
  vacancies: Vacancy[]
  quizzes: Quiz[]
  /** Банки для повторения в тренажёре */
  drills: Drill[]
  /** Упражнения тренажёра: упорядочить, сопоставить, найти ошибку */
  exercises: ExerciseSet[]
  /** Залы: подходы в терминале стенда с автоматическим зачётом */
  gyms: GymDef[]
  incidents: IncidentDef[]
  /** Сильные стороны профиля, которые не входят в score напрямую, но переносятся в роль. */
}

// ─────────────────────────────────────────────────────────────────────────────
// User progress — всё, что пользователь вводит. Именно это экспортируется/импортируется.
// ─────────────────────────────────────────────────────────────────────────────

export interface Evidence {
  id: string
  type: EvidenceType
  value: string
  description?: string
  createdAt: string
}

export interface TaskProgress {
  status: TaskStatus
  evidence: Evidence[]
  notes: string
  /** Тексты выполненных acceptance criteria. Если текст критерия в curriculum изменится,
   *  отметка сбросится — это сознательное поведение: новый критерий надо подтвердить заново. */
  criteriaDone: string[]
  updatedAt?: string
  completedAt?: string
  /** Попытки контрольного теста (только для задач kind: 'quiz') */
  quizAttempts?: QuizAttempt[]
  timing?: TaskTiming
}

export interface QuizAttempt {
  id: string
  at: string
  correct: number
  total: number
  passed: boolean
  /** id вопросов, на которых ошибся, — для разбора слабых мест */
  wrongIds: string[]
}

/** Статистика тренировки по одному вопросу (тренажёр + ответы в тестах). */
export interface PracticeStat {
  seen: number
  correct: number
  /** Сколько раз подряд ответил верно */
  streak: number
  lastCorrect: boolean
  lastAt: string
}

export interface SkillProgress {
  /** Скорректированная самооценка. Учитывается в match, только если есть обоснование (note). */
  selfLevel?: Level
  note?: string
}

/** 0 — не могу ответить, 1 — отвечу с подсказкой, 2 — объясню самостоятельно.
 *  3 — старая оценка «Покажу практический пример»: сохраняется в файле, читается как 2. */
export type InterviewRating = 0 | 1 | 2 | 3

export interface InterviewAnswer {
  /** Текущая оценка (после сверки с тезисами, если сверка была) */
  rating: InterviewRating
  /** Оценка вслепую — до того, как открыты тезисы. Расхождение с rating показывает переоценку себя */
  blindRating?: InterviewRating
  /** Когда ответ сверен с ключевыми тезисами */
  checkedAt?: string
  /** Когда последний раз поставлена оценка; редактирование заметки не сдвигает повторение */
  ratedAt?: string
  note?: string
  updatedAt: string
}

/** Закладка «сохранить на потом» у задачи, инцидента или материала */
export interface SavedItem {
  kind: 'task' | 'incident' | 'resource'
  id: string
  at: string
}

/** Свой ответ на кейс проектирования */
export interface DesignAnswer {
  text: string
  /** Аспекты, которые ответ покрывает, — отмечены вслепую, до разбора */
  covered: string[]
  /** Аспекты после сверки с разбором (появляются при сверке) */
  coveredAfter?: string[]
  /** Когда открыт разбор */
  checkedAt?: string
  updatedAt: string
}

export interface JournalEntry {
  id: string
  date: string
  did: string
  learned: string
  unclear: string
  evidenceUrl: string
  taskId?: string
}

export interface IncidentCheckResult {
  id: string
  ok: boolean
  message: string
}

/** Отчёт автопроверки (incidents/_tools/verify.py) */
export interface IncidentReport {
  id: string
  at: string
  passed: boolean
  checks: IncidentCheckResult[]
  /** Архитектура машины, где шла проверка (aarch64 — Mac, x86_64 — Windows/Linux) */
  arch?: string
  source: 'auto' | 'upload'
}

export interface IncidentProgress {
  startedAt?: string
  hintsShown: number
  /** Разбор открыт до решения — решение помечается «с разбором» */
  debriefOpenedAt?: string
  /** Первый отчёт, где прошли все проверки */
  solvedAt?: string
  reports: IncidentReport[]
}

export interface UserProgress {
  /** Необязательные замеры; не участвуют в зачёте и уровнях навыков. */
  measurements?: Measurement[]
  /** Учебные экзамены CKA; не участвуют в прогрессе программы и навыках. */
  ckaExams?: CkaExamAttempt[]
  schemaVersion: 1
  activeVacancyId: string
  tasks: Record<string, TaskProgress>
  resources: Record<string, { completed: boolean; completedAt?: string }>
  skills: Record<string, SkillProgress>
  interview: {
    answers: Record<string, InterviewAnswer>
    /** caseId → свой ответ на кейс проектирования */
    designs: Record<string, DesignAnswer>
  }
  journal: JournalEntry[]
  /** Попытки сквозного экзамена по всем трекам */
  finalExam: QuizAttempt[]
  /** questionId → статистика тренажёра */
  practice: Record<string, PracticeStat>
  /** incidentId → прогресс по инциденту */
  incidents: Record<string, IncidentProgress>
  /** Закладки «сохранить на потом» */
  saved: SavedItem[]
  /** gymId → сессии зала */
  gyms: Record<string, GymProgress>
  meta: {
    createdAt: string
    updatedAt: string
    curriculumVersion: string
  }
}

// Дополнительные записи обучения: отсутствующие поля старого прогресса не заполняются задним числом.
export interface TaskTiming {
  startedAt: string
  firstVerifiedAt?: string
}

export type MeasurementMetric = 'ttft' | 'throughput' | 'recall' | 'memory'
export interface Measurement {
  id: string
  taskId: string
  date: string
  metric: MeasurementMetric
  value: number
  unit: string
  model: string
  hardware: string
  conditions: string
}

export interface CkaExamAttempt {
  id: string
  variantId: string
  createdAt: string
  phase: 'preparing' | 'running' | 'checking' | 'finished' | 'cancelled'
  startedAt?: string
  submittedAt?: string
  finishedAt?: string
  autoSubmissionTried?: boolean
  reports: Record<string, IncidentReport>
  error?: string
}
