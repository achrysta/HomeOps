/** Параметры новых инструментов; не веса зачёта программы и покрытия профиля. */
export const DIAGNOSTIC_POLICY = { minMinutes: 15, maxMinutes: 30, minQuestions: 22, maxQuestions: 30, solidAnswers: 2, minPerTrack: 2, maxPerTrack: 3, skillPriority: { required: 3, important: 2, bonus: 1 } } as const
export const PROGRESS_REQUEST_TIMEOUT_MS = 10_000
export const CKA_EXAM_POLICY = { minutes: 120, minVariantMinutes: 100, maxVariantMinutes: 130, actionTimeoutMs: 600_000, reportTimeoutMs: 15_000, referencePercent: 66 } as const
/** Цель обучения нового пользователя; выбранную цель хранит progress.activeVacancyId, профиль меняют на странице «Навыки». */
export const DEFAULT_VACANCY_ID = 'platform-engineer'
