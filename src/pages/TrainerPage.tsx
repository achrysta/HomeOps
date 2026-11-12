import { Blocks, BrainCircuit, CheckCircle2, Dumbbell, Map as MapIcon, RotateCcw, Server, XCircle } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ExerciseCard } from '../components/ExerciseCard'
import { InlineText } from '../components/InlineText'
import { Badge, Button, Card, InfoTip, PageHeader, ProgressBar, Segmented } from '../components/ui'
import { EXERCISE_KIND_LABEL, exerciseLayout, exerciseSolution, initialAnswer, isComplete, isExerciseCorrect, type ExerciseAnswer } from '../lib/exercises'
import { DRILL_AREAS, DRILL_GROUPS } from '../data/drills'
import { drillGroup, drillLabel } from '../lib/drills'
import { CKA_DOMAIN_ORDER } from '../lib/incidents'
import { CKA_DOMAIN_LABEL, pct } from '../lib/labels'
import { isCorrect, isDue, isMastered, pickPracticeQuestions, reviewDueAt, shuffle, type PracticeMode } from '../lib/quiz'
import { useStore } from '../state/context'
import { navigate, useRoute } from '../state/router'
import { useLocalState } from '../state/useLocalState'
import { useNow } from '../state/useNow'
import type { CkaDomain, Curriculum, Exercise, QuizQuestion } from '../types'
import { ReportIssue } from '../components/ReportIssue'
import { TrainerTabs } from '../components/SectionTabs'

interface Settings {
  tracks: string[]
  mode: PracticeMode
  length: number
  /** Сначала показать только вопрос: сформулировать ответ самому, потом открыть варианты */
  recall: boolean
  /** Домены CKA для банка «Kubernetes» (пусто — все); в старых настройках поля нет */
  cka?: CkaDomain[]
}

/** Банк DevOps-базы с доменами CKA у вопросов */
const K8S_DRILL = 'dv-k8s'

/** Что тренирует тренажёр: вопрос с вариантами (тесты треков, DevOps-база) или упражнение */
type Entry = { id: string; trackId: string } & ({ kind: 'question'; question: QuizQuestion } | { kind: 'exercise'; exercise: Exercise })

type Item =
  | { kind: 'question'; question: QuizQuestion; trackId: string; order: number[] }
  /** layout — перемешанные варианты сопоставления или блоки архитектуры */
  | { kind: 'exercise'; exercise: Exercise; trackId: string; layout: number[] }

interface Session {
  items: Item[]
  index: number
  chosen: number[]
  /** Ответ на упражнение (у вопросов — null) */
  answer: ExerciseAnswer | null
  checked: boolean
  /** Варианты открыты (в режиме recall сначала скрыты) */
  revealed: boolean
  recall: boolean
  results: { item: Item; correct: boolean }[]
}

const LENGTHS = [
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 0, label: 'Все' },
]

export function TrainerPage() {
  const { curriculum, idx, progress, dispatch } = useStore()
  const [storedSettings, setStoredSettings] = useLocalState<Settings>('trainer.settings', { tracks: [], mode: 'smart', length: 10, recall: true })
  const { params } = useRoute()
  const modeParam = params.get('mode')
  const linkedMode = modeParam === 'due' || modeParam === 'smart' || modeParam === 'mistakes' || modeParam === 'random' ? modeParam : null
  // Выбор из ссылки: scope=all — всё, что повторяет тренажёр; scope=exercises — только упражнения
  const scope = params.get('scope')
  const linkedTracks =
    scope === 'all'
      ? [...curriculum.quizzes.map((q) => q.trackId), ...curriculum.drills.map((d) => d.id), ...curriculum.exercises.map((x) => x.id)]
      : scope === 'exercises'
        ? curriculum.exercises.map((x) => x.id)
        : null
  const settings: Settings = {
    ...storedSettings,
    mode: linkedMode ?? storedSettings.mode,
    tracks: linkedTracks ?? storedSettings.tracks,
  }
  const setSettings = (next: Settings) => {
    setStoredSettings(next)
    if (linkedMode || linkedTracks) {
      const rest = new URLSearchParams(params)
      rest.delete('mode')
      rest.delete('scope')
      navigate('trainer', Object.fromEntries(rest))
    }
  }
  // Ссылка на одно задание (?item=id, например из набора на сегодня) сразу открывает его
  const itemParam = params.get('item')
  const itemSession = (id: string | null): Session | null => {
    const entry = id ? entryById(curriculum, id) : undefined
    if (!entry) return null
    const items = [toItem(entry)]
    return { items, index: 0, results: [], recall: storedSettings.recall, ...fresh(items[0], storedSettings.recall) }
  }
  const [session, setSession] = useState<Session | null>(() => itemSession(itemParam))
  const [finished, setFinished] = useState<Session | null>(null)
  // Ссылка на другое задание, пока тренажёр уже открыт (карточка навыка, «Назад»): страница не монтируется заново,
  // поэтому новое задание открываем, когда меняется параметр, — без effect, по шаблону «состояние от пропа»
  const [openedItem, setOpenedItem] = useState(itemParam)
  if (itemParam !== openedItem) {
    setOpenedItem(itemParam)
    const next = itemSession(itemParam)
    if (next) {
      setSession(next)
      setFinished(null)
    }
  }

  // Всё, что можно тренировать, с группой: трек (контрольные тесты), банк DevOps-базы или набор упражнений
  const entries = useMemo<Entry[]>(
    () => [
      ...curriculum.quizzes.flatMap((qz) => qz.questions.map((q): Entry => ({ id: q.id, trackId: qz.trackId, kind: 'question', question: q }))),
      ...curriculum.drills.flatMap((d) => d.questions.map((q): Entry => ({ id: q.id, trackId: d.id, kind: 'question', question: q }))),
      ...curriculum.exercises.flatMap((set) => set.exercises.map((e): Entry => ({ id: e.id, trackId: set.id, kind: 'exercise', exercise: e }))),
    ],
    [curriculum],
  )
  const allQuestions = useMemo(() => curriculum.quizzes.flatMap((qz) => qz.questions), [curriculum])
  const trackIds = new Set(curriculum.quizzes.map((qz) => qz.trackId))
  const exerciseIds = curriculum.exercises.map((x) => x.id)
  const cka = settings.cka ?? []
  const k8sDrill = curriculum.drills.find((d) => d.id === K8S_DRILL)
  // Ничего не выбрано — все вопросы треков; банки повторения и упражнения выбираются явно.
  // Домен у вопроса есть только в банке «Kubernetes»: выбранные домены сужают его, остальное не трогают
  const pool = (settings.tracks.length === 0 ? entries.filter((e) => trackIds.has(e.trackId)) : entries.filter((e) => settings.tracks.includes(e.trackId))).filter(
    (e) => !cka.length || e.kind !== 'question' || !e.question.cka || cka.includes(e.question.cka),
  )
  const groupTitle = (id: string) => {
    const t = idx.trackById.get(id)
    if (t) return `${t.code} · ${t.title}`
    const set = curriculum.exercises.find((x) => x.id === id)
    if (set) return `Упражнения · ${set.title}`
    const drill = curriculum.drills.find((d) => d.id === id)
    return drill ? drillLabel(drill) : id
  }
  const allExercisesSelected = exerciseIds.every((id) => settings.tracks.includes(id))
  const now = useNow()
  const mistakes = pool.filter((e) => progress.practice[e.id] && !progress.practice[e.id].lastCorrect).length
  const due = pool.filter((e) => isDue(progress.practice[e.id], now)).length
  const mastered = allQuestions.filter((q) => isMastered(progress.practice[q.id], now)).length
  const dueAll = entries.filter((e) => isDue(progress.practice[e.id], now)).length
  const dueWeek = entries.filter((e) => {
    const at = reviewDueAt(progress.practice[e.id])
    return at !== null && at > now && at <= now + 7 * 86_400_000
  }).length
  const available = settings.mode === 'mistakes' ? mistakes : settings.mode === 'due' ? due : pool.length

  const start = (list?: Entry[]) => {
    const picked = list ?? pickPracticeQuestions(pool, progress.practice, settings.mode, settings.length || pool.length, now)
    if (!picked.length) return
    setFinished(null)
    const items = picked.map(toItem)
    setSession({ items, index: 0, results: [], recall: settings.recall, ...fresh(items[0], settings.recall) })
  }

  const picked = (ids: string[]) => {
    const n = ids.filter((id) => settings.tracks.includes(id)).length
    return n === 0 ? 'не выбрано' : n === ids.length ? 'выбраны все' : `выбрано ${n} из ${ids.length}`
  }
  const toggleTrack = (id: string) => {
    const has = settings.tracks.includes(id)
    setSettings({ ...settings, tracks: has ? settings.tracks.filter((t) => t !== id) : [...settings.tracks, id] })
  }
  const toggleCka = (domain: CkaDomain) => setSettings({ ...settings, cka: cka.includes(domain) ? cka.filter((d) => d !== domain) : [...cka, domain] })
  /** Выбрать или снять группу тем целиком: все банки DevOps-базы, раздел, все упражнения */
  const toggleMany = (ids: string[]) => {
    const all = ids.every((id) => settings.tracks.includes(id))
    setSettings({ ...settings, tracks: all ? settings.tracks.filter((t) => !ids.includes(t)) : [...new Set([...settings.tracks, ...ids])] })
  }

  if (session) {
    return (
      <SessionView
        session={session}
        onChange={setSession}
        onAnswer={(questionId, correct) => dispatch({ type: 'practice/record', results: [{ questionId, correct }] })}
        onFinish={(s) => {
          setSession(null)
          setFinished(s)
          if (itemParam) {
            const rest = new URLSearchParams(params)
            rest.delete('item')
            navigate('trainer', Object.fromEntries(rest))
          }
        }}
        trackTitle={groupTitle}
      />
    )
  }

  return (
    <div>
      <PageHeader eyebrow="Практика"
        title="Тренажёр"
        description={
          <>
            Один вопрос или упражнение за раз — сразу проверка и разбор.{' '}
            <InfoTip label="Как пользоваться тренажёром">Сначала сформулируйте ответ сами, потом нажимайте «Проверить». Верные ответы возвращаются через 1, 3, 7, 14 и 30 дней. На зачёт задач тренажёр не влияет: это тренировка теории.</InfoTip>
          </>
        }
        actions={<TrainerTabs active="trainer" />}
      />

      {finished && <Summary session={finished} onRetryMistakes={(list) => start(list)} onNew={() => start()} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Новая сессия">
          <div className="space-y-6">
            <section className="space-y-4">
              <h3 className="text-xs font-semibold tracking-wider text-subtle uppercase">Что тренировать</h3>
              <ChipGroup
                icon={<MapIcon size={17} />}
                tone="bg-accent/10 text-accent"
                title="Контрольные тесты треков"
                meta={`${curriculum.quizzes.length} треков · ${curriculum.quizzes.reduce((n, q) => n + q.questions.length, 0)} вопросов`}
                selected={settings.tracks.length === 0 ? 'все треки' : picked(curriculum.quizzes.map((q) => q.trackId))}
              >
                <Chip active={settings.tracks.length === 0} onClick={() => setSettings({ ...settings, tracks: [] })}>
                  Все треки
                </Chip>
                {curriculum.quizzes.map((qz) => {
                  const t = idx.trackById.get(qz.trackId)!
                  return (
                    <Chip key={t.id} active={settings.tracks.includes(t.id)} onClick={() => toggleTrack(t.id)}>
                      {t.code} · {t.title}
                    </Chip>
                  )
                })}
              </ChipGroup>
              {DRILL_GROUPS.map((group) => {
                const groupAreas = DRILL_AREAS.filter((a) => a.group === group.id)
                const banks = curriculum.drills.filter((d) => drillGroup(d) === group.id)
                if (!banks.length) return null
                const ids = banks.map((d) => d.id)
                return (
                  <ChipGroup
                    key={group.id}
                    icon={group.id === 'mlops' ? <BrainCircuit size={17} /> : <Server size={17} />}
                    tone={group.id === 'mlops' ? 'bg-ok/10 text-ok' : 'bg-violet/10 text-violet'}
                    title={group.title}
                    meta={`${group.description} · ${banks.length} тем · ${banks.reduce((n, d) => n + d.questions.length, 0)} вопросов`}
                    selected={picked(ids)}
                  >
                    <Chip active={ids.every((id) => settings.tracks.includes(id))} onClick={() => toggleMany(ids)}>
                      Вся {group.title}
                    </Chip>
                    {groupAreas.map((area) => {
                      const areaBanks = curriculum.drills.filter((d) => d.area === area.id)
                      const areaIds = areaBanks.map((d) => d.id)
                      return (
                        <Fragment key={area.id}>
                          {groupAreas.length > 1 && (
                            <div className="flex basis-full items-baseline gap-2 pt-2 text-xs">
                              <span className="font-medium text-muted">{area.title}</span>
                              <button type="button" onClick={() => toggleMany(areaIds)} className="text-accent hover:underline">
                                {areaIds.every((id) => settings.tracks.includes(id)) ? 'снять' : 'выбрать раздел'}
                              </button>
                            </div>
                          )}
                          {areaBanks.map((d) => (
                            <Chip key={d.id} active={settings.tracks.includes(d.id)} onClick={() => toggleTrack(d.id)}>
                              {d.title}
                            </Chip>
                          ))}
                          {k8sDrill?.area === area.id && settings.tracks.includes(K8S_DRILL) && (
                            <div className="mt-1 flex min-w-0 basis-full flex-wrap items-center gap-1.5 rounded-lg bg-surface/70 p-2.5">
                              <span className="mr-1 flex items-center gap-1 text-xs font-medium text-muted">
                                Kubernetes по доменам CKA
                                <InfoTip label="Домены CKA">Вопросы банка «Kubernetes» размечены по доменам программы CKA v1.35. Рядом с доменом — его вес в экзамене. Ничего не выбрано — весь банк.</InfoTip>
                              </span>
                              <Chip active={!cka.length} onClick={() => setSettings({ ...settings, cka: [] })}>
                                Все домены
                              </Chip>
                              {CKA_DOMAIN_ORDER.map((domain) => (
                                <Chip key={domain} active={cka.includes(domain)} onClick={() => toggleCka(domain)}>
                                  {CKA_DOMAIN_LABEL[domain].title} · {CKA_DOMAIN_LABEL[domain].weight}% · {k8sDrill.questions.filter((x) => x.cka === domain).length} вопр.
                                </Chip>
                              ))}
                            </div>
                          )}
                        </Fragment>
                      )
                    })}
                  </ChipGroup>
                )
              })}
              <ChipGroup
                icon={<Blocks size={17} />}
                tone="bg-info/10 text-info"
                title="Упражнения"
                meta={`порядок, пары, ошибки и архитектура · ${curriculum.exercises.reduce((n, x) => n + x.exercises.length, 0)} упражнений`}
                selected={picked(exerciseIds)}
              >
                <Chip active={allExercisesSelected} onClick={() => toggleMany(exerciseIds)}>
                  Все упражнения
                </Chip>
                {curriculum.exercises.map((x) => (
                  <Chip key={x.id} active={settings.tracks.includes(x.id)} onClick={() => toggleTrack(x.id)}>
                    {x.title}
                  </Chip>
                ))}
              </ChipGroup>
            </section>

            <section className="space-y-4 border-t border-line pt-5">
              <h3 className="text-xs font-semibold tracking-wider text-subtle uppercase">Как тренировать</h3>
              <div className="flex flex-wrap gap-x-8 gap-y-4">
                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-fg">
                    Режим
                    <InfoTip label="Как подбираются вопросы">
                      {settings.mode === 'smart' &&
                        'Чаще даёт ошибки, вопросы, которые пора повторить, и новые. Вопрос, на который ответили верно, возвращается через 1, 3, 7, 14 и 30 дней — чем длиннее серия верных ответов, тем реже.'}
                      {settings.mode === 'due' && 'Только вопросы, срок повторения которых наступил, включая последние ошибки. Самые просроченные — первыми.'}
                      {settings.mode === 'mistakes' && 'Только вопросы, на которые последний раз ответили неверно — в тренажёре или в тестах.'}
                      {settings.mode === 'random' && 'Случайный набор без учёта статистики.'}
                    </InfoTip>
                  </div>
                  <Segmented
                    value={settings.mode}
                    onChange={(mode) => setSettings({ ...settings, mode })}
                    options={[
                      { value: 'smart', label: 'Умный' },
                      { value: 'due', label: `Пора повторить · ${due}` },
                      { value: 'mistakes', label: `Мои ошибки · ${mistakes}` },
                      { value: 'random', label: 'Случайно' },
                    ]}
                  />
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium text-fg">Вопросов</div>
                  <Segmented value={settings.length} onChange={(length) => setSettings({ ...settings, length })} options={LENGTHS} />
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <label className="flex cursor-pointer items-center gap-2 select-none">
                  <input type="checkbox" checked={settings.recall} onChange={(e) => setSettings({ ...settings, recall: e.target.checked })} className="accent-[var(--accent)]" />
                  <span className="font-medium text-fg">Сначала без вариантов</span>
                </label>
                <InfoTip label="Зачем отвечать без вариантов">
                  Видите только вопрос, формулируете ответ сами (лучше вслух), потом открываете варианты. Так проверяется знание, а не умение узнать ответ среди вариантов.
                </InfoTip>
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
              <Button variant="primary" size="lg" onClick={() => start()} disabled={available === 0}>
                <Dumbbell size={16} /> Начать · {Math.min(settings.length || available, available)} вопр.
              </Button>
              {available === 0 && <span className="text-sm text-muted">В выбранном режиме вопросов нет — выберите другие темы или режим.</span>}
            </div>
          </div>
        </Card>

        <Card title="Освоение" subtitle="Освоен = помню сейчас: последний ответ верный, минимум два верных подряд и срок повторения ещё не наступил">
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-fg tabular-nums">{mastered}</span>
            <span className="text-sm text-muted">из {allQuestions.length} вопросов</span>
          </div>
          <div className="mb-4 text-xs text-muted">
            пора повторить: <span className={dueAll ? 'font-medium text-warn' : ''}>{dueAll}</span> · в ближайшую неделю: {dueWeek}
          </div>
          <div className="space-y-2.5">
            {curriculum.quizzes.map((qz) => {
              const t = idx.trackById.get(qz.trackId)!
              const m = qz.questions.filter((q) => isMastered(progress.practice[q.id], now)).length
              return (
                <div key={qz.id}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-muted">
                      {t.code} · {t.title}
                    </span>
                    <span className="font-semibold text-fg tabular-nums">
                      {m}/{qz.questions.length}
                    </span>
                  </div>
                  <ProgressBar value={m / qz.questions.length} size="sm" tone={m === qz.questions.length ? 'ok' : 'accent'} />
                </div>
              )
            })}
          </div>
          {DRILL_GROUPS.filter((group) => curriculum.drills.some((d) => drillGroup(d) === group.id)).map((group) => (
            <Fragment key={group.id}>
              <div className="mt-5 mb-2 text-xs font-semibold tracking-wide text-subtle uppercase">{group.title}</div>
              {DRILL_AREAS.filter((area) => area.group === group.id && curriculum.drills.some((d) => d.area === area.id)).map((area, _, areas) => (
                <div key={area.id} className="mb-3">
                  {areas.length > 1 && <div className="mb-1.5 text-xs text-subtle">{area.title}</div>}
                  <div className="space-y-2.5">
                    {curriculum.drills
                      .filter((d) => d.area === area.id)
                      .map((d) => {
                        const m = d.questions.filter((q) => isMastered(progress.practice[q.id], now)).length
                        return (
                          <div key={d.id}>
                            <div className="mb-1 flex justify-between text-xs">
                              <span className="text-muted">{d.title}</span>
                              <span className="font-semibold text-fg tabular-nums">
                                {m}/{d.questions.length}
                              </span>
                            </div>
                            <ProgressBar value={m / d.questions.length} size="sm" tone={m === d.questions.length ? 'ok' : group.id === 'mlops' ? 'accent' : 'violet'} />
                          </div>
                        )
                      })}
                  </div>
                </div>
              ))}
            </Fragment>
          ))}
          <div className="mt-5 mb-2 text-xs font-semibold tracking-wide text-subtle uppercase">Упражнения</div>
          <div className="space-y-2.5">
            {curriculum.exercises.map((x) => {
              const m = x.exercises.filter((e) => isMastered(progress.practice[e.id], now)).length
              return (
                <div key={x.id}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-muted">{x.title}</span>
                    <span className="font-semibold text-fg tabular-nums">
                      {m}/{x.exercises.length}
                    </span>
                  </div>
                  <ProgressBar value={m / x.exercises.length} size="sm" tone={m === x.exercises.length ? 'ok' : 'info'} />
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}

function entryById(c: Curriculum, id: string): Entry | undefined {
  for (const qz of c.quizzes) for (const q of qz.questions) if (q.id === id) return { id, trackId: qz.trackId, kind: 'question', question: q }
  for (const d of c.drills) for (const q of d.questions) if (q.id === id) return { id, trackId: d.id, kind: 'question', question: q }
  for (const set of c.exercises) for (const e of set.exercises) if (e.id === id) return { id, trackId: set.id, kind: 'exercise', exercise: e }
  return undefined
}

function toItem(e: Entry): Item {
  if (e.kind === 'question') return { kind: 'question', question: e.question, trackId: e.trackId, order: shuffle(e.question.options.map((_, i) => i)) }
  return { kind: 'exercise', exercise: e.exercise, trackId: e.trackId, layout: exerciseLayout(e.exercise) }
}

const itemEntry = (item: Item): Entry =>
  item.kind === 'question'
    ? { id: item.question.id, trackId: item.trackId, kind: 'question', question: item.question }
    : { id: item.exercise.id, trackId: item.trackId, kind: 'exercise', exercise: item.exercise }

/** Состояние нового задания: упражнение видно сразу, варианты вопроса — по настройке «сначала без вариантов» */
function fresh(item: Item, recall: boolean): Pick<Session, 'chosen' | 'answer' | 'checked' | 'revealed'> {
  return { chosen: [], answer: item.kind === 'exercise' ? initialAnswer(item.exercise) : null, checked: false, revealed: item.kind === 'exercise' || !recall }
}

/** Группа выбора: иконка в тонированном квадрате, заголовок и сводка — заметно отличаются от чипов под ними. */
function ChipGroup({ icon, tone, title, meta, selected, children }: { icon: ReactNode; tone: string; title: string; meta: string; selected: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-2/60 p-3.5">
      <div className="mb-3 flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-fg">{title}</div>
          <div className="text-xs text-muted">{meta}</div>
          <div className="text-xs text-subtle sm:hidden">{selected}</div>
        </div>
        <span className="hidden shrink-0 pt-0.5 text-xs text-subtle sm:block">{selected}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${active ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line bg-surface text-muted hover:border-subtle hover:text-fg'}`}
    >
      {children}
    </button>
  )
}

function SessionView({
  session,
  onChange,
  onAnswer,
  onFinish,
  trackTitle,
}: {
  session: Session
  onChange: (s: Session) => void
  onAnswer: (questionId: string, correct: boolean) => void
  onFinish: (s: Session) => void
  trackTitle: (id: string) => string
}) {
  const item = session.items[session.index]
  const q = item.kind === 'question' ? item.question : null
  const multi = !!q && q.correct.length > 1
  const correctSoFar = session.results.filter((r) => r.correct).length
  const last = session.index === session.items.length - 1
  const ready = item.kind === 'question' ? session.chosen.length > 0 : !!session.answer && isComplete(session.answer)

  const toggle = useCallback(
    (opt: number) => {
      if (session.checked || !session.revealed || !q) return
      const chosen = multi ? (session.chosen.includes(opt) ? session.chosen.filter((x) => x !== opt) : [...session.chosen, opt]) : [opt]
      onChange({ ...session, chosen })
    },
    [session, q, multi, onChange],
  )

  const check = useCallback(() => {
    if (session.checked || !ready) return
    const id = item.kind === 'question' ? item.question.id : item.exercise.id
    const ok = item.kind === 'question' ? isCorrect(item.question, session.chosen) : isExerciseCorrect(item.exercise, session.answer!)
    onAnswer(id, ok)
    onChange({ ...session, checked: true, results: [...session.results, { item, correct: ok }] })
  }, [session, item, ready, onAnswer, onChange])

  const reveal = useCallback(() => onChange({ ...session, revealed: true }), [session, onChange])

  const next = useCallback(() => {
    if (!session.checked) return
    if (last) onFinish(session)
    else onChange({ ...session, index: session.index + 1, ...fresh(session.items[session.index + 1], session.recall) })
  }, [session, last, onFinish, onChange])

  // Клавиатура: 1–9 — выбрать вариант вопроса, Enter — показать варианты / проверить / дальше
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.defaultPrevented || target.closest('input, textarea, select, [contenteditable], [role="dialog"], [data-hotkeys="off"]')) return
      const n = Number(e.key)
      if (item.kind === 'question' && n >= 1 && n <= item.order.length) toggle(item.order[n - 1])
      if (e.key === 'Enter') {
        e.preventDefault()
        if (!session.revealed) reveal()
        else if (session.checked) next()
        else check()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, session.checked, session.revealed, toggle, check, next, reveal])

  const ok = session.checked && session.results.at(-1)?.correct === true
  const text = item.kind === 'question' ? item.question.text : item.exercise.text
  const explanation = item.kind === 'question' ? item.question.explanation : item.exercise.explanation

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-3">
        <span className="text-sm text-muted">
          Задание <b className="font-mono text-fg">{session.index + 1}</b> из {session.items.length}
        </span>
        <span className="text-sm text-muted">· верно {correctSoFar}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onFinish(session)}>
          Завершить
        </Button>
      </div>
      <ProgressBar value={session.index / session.items.length} size="sm" className="mb-5" />

      <Card>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-subtle">
          {trackTitle(item.trackId)}
          {item.kind === 'exercise' && !trackTitle(item.trackId).endsWith(EXERCISE_KIND_LABEL[item.exercise.kind]) && <Badge tone="info">{EXERCISE_KIND_LABEL[item.exercise.kind]}</Badge>}
          {item.kind === 'question' && item.question.cka && <Badge>CKA · {CKA_DOMAIN_LABEL[item.question.cka].title}</Badge>}
        </div>
        <div className="mb-4 text-base leading-relaxed font-medium text-fg">
          <InlineText text={text} />
        </div>
        {item.kind === 'question' && item.question.output && (
          <pre className="scrollbar-thin mb-4 max-h-80 overflow-y-auto rounded-lg bg-surface-2 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere text-fg">{item.question.output}</pre>
        )}
        {item.kind === 'exercise' && session.answer ? (
          <ExerciseCard exercise={item.exercise} layout={item.layout} answer={session.answer} checked={session.checked} onChange={(answer) => onChange({ ...session, answer })} />
        ) : !session.revealed ? (
          <div className="rounded-md border border-dashed border-line bg-surface-2/40 px-4 py-5 text-sm">
            <div className="text-muted">Сформулируйте ответ сами — вслух или в голове. Потом откройте варианты и выберите тот, что совпадает с вашим ответом.</div>
            <Button variant="primary" className="mt-4" onClick={reveal}>
              Показать варианты
            </Button>
            <span className="ml-3 text-xs text-subtle">Enter</span>
          </div>
        ) : (
          q &&
          item.kind === 'question' && (
            <>
              {multi && <div className="mb-2 text-xs text-warn">Несколько правильных вариантов</div>}
              <div className="space-y-2">
                {item.order.map((opt, n) => {
                  const chosen = session.chosen.includes(opt)
                  const right = q.correct.includes(opt)
                  let style = chosen ? 'border-accent bg-accent/10' : 'border-line hover:border-subtle'
                  if (session.checked) style = right ? 'border-ok/50 bg-ok/10' : chosen ? 'border-bad/50 bg-bad/10' : 'border-line opacity-60'
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggle(opt)}
                      className={`flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left text-sm text-fg transition-colors ${style}`}
                    >
                      <span className="mt-px font-mono text-xs text-subtle">{n + 1}</span>
                      <span className="min-w-0">
                        <InlineText text={q.options[opt]} />
                        {session.checked && chosen && !right && q.optionNotes?.[opt] && (
                          <span className="mt-1 block text-xs leading-relaxed text-bad">
                            <InlineText text={q.optionNotes[opt]} />
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )
        )}

        {session.checked && (
          <div className={`mt-4 rounded-md border px-4 py-3 text-sm ${ok ? 'border-ok/30 bg-ok/5' : 'border-bad/30 bg-bad/5'}`}>
            <div className={`mb-1 flex items-center gap-1.5 font-medium ${ok ? 'text-ok' : 'text-bad'}`}>
              {ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />} {ok ? 'Верно' : 'Неверно'}
            </div>
            <div className="leading-relaxed text-muted">
              <InlineText text={explanation} />
            </div>
            <ReportIssue
              kind={item.kind === 'question' ? 'question' : 'exercise'}
              targetId={item.kind === 'question' ? item.question.id : item.exercise.id}
              targetTitle={text}
              className="mt-2"
            />
          </div>
        )}

        <div className="mt-5 flex items-center gap-3">
          {!session.revealed ? null : session.checked ? (
            <Button variant="primary" onClick={next}>
              {last ? 'Итоги' : 'Дальше'}
            </Button>
          ) : (
            <Button variant="primary" onClick={check} disabled={!ready}>
              Проверить
            </Button>
          )}
          {session.revealed && (
            <span className="text-xs text-subtle">
              {item.kind === 'question' ? `Клавиши: 1–${item.order.length} — выбор, ` : 'Клавиша: '}Enter — {session.checked ? 'дальше' : 'проверить'}
            </span>
          )}
        </div>
      </Card>
    </div>
  )
}

function Summary({ session, onRetryMistakes, onNew }: { session: Session; onRetryMistakes: (list: Entry[]) => void; onNew: () => void }) {
  const total = session.results.length
  const correct = session.results.filter((r) => r.correct).length
  const wrong = session.results.filter((r) => !r.correct)
  if (total === 0) return null
  return (
    <Card className="mb-6" title="Итоги сессии">
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-3xl font-semibold text-fg tabular-nums">{pct(correct / total)}</span>
        <span className="text-sm text-muted">
          {correct} из {total} верно
        </span>
        <span className="ml-auto flex gap-2">
          {wrong.length > 0 && (
            <Button onClick={() => onRetryMistakes(wrong.map((w) => itemEntry(w.item)))}>
              <RotateCcw size={14} /> Повторить ошибки · {wrong.length}
            </Button>
          )}
          <Button variant="primary" onClick={onNew}>
            Ещё сессия
          </Button>
        </span>
      </div>
      {wrong.length > 0 && (
        <div className="mt-4 space-y-3">
          {wrong.map(({ item }) => {
            const e = itemEntry(item)
            const text = e.kind === 'question' ? e.question.text : e.exercise.text
            const solution = e.kind === 'question' ? e.question.correct.map((c) => e.question.options[c]).join('; ') : exerciseSolution(e.exercise)
            return (
              <div key={e.id} className="rounded-md border border-line px-3 py-2.5 text-sm">
                <div className="font-medium text-fg">
                  <InlineText text={text} />
                </div>
                {e.kind === 'question' && e.question.output && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted">Вывод из вопроса</summary>
                    <pre className="scrollbar-thin mt-1 max-h-60 overflow-y-auto rounded-lg bg-surface-2 p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere text-fg">{e.question.output}</pre>
                  </details>
                )}
                <div className="mt-1 text-ok">
                  <Badge tone="ok">Ответ</Badge> <InlineText text={solution} />
                </div>
                <div className="mt-1 text-xs leading-relaxed text-muted">
                  <InlineText text={e.kind === 'question' ? e.question.explanation : e.exercise.explanation} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
