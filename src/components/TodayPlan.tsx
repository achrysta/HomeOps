import { ArrowRight, Check, ChevronDown, Dumbbell, EyeOff, MessagesSquare, Siren, SkipForward, Timer, X } from 'lucide-react'
import {
  dailyDoneCount,
  dailySet,
  dailyTopicTitle,
  dayKey,
  EMPTY_DAILY_PREFS,
  recommendedDailyItem,
  type DailyItem,
  type DailyKind,
  type DailyPrefs,
  type DailyStatus,
} from '../lib/daily'
import { FORMAT_LABEL, FORMAT_TONE, KIND_LABEL, TONE_TEXT } from '../lib/labels'
import type { NextAction } from '../lib/progress'
import { todayIncident } from '../lib/today'
import { useStore } from '../state/context'
import { buildHash, setTaskParam } from '../state/router'
import { useLocalState } from '../state/useLocalState'
import { useNow } from '../state/useNow'
import { Button, InfoTip } from './ui'

const ICON: Record<DailyKind, typeof Dumbbell> = { trainer: Dumbbell, interview: MessagesSquare, incident: Siren, gym: Timer }
const OPEN: Record<DailyKind, string> = { trainer: 'Ответить', interview: 'Ответить вслух', incident: 'Открыть стенд', gym: 'Открыть зал' }
const STATUS: Record<DailyStatus, string> = { done: 'сделано сегодня', due: 'пора повторить', in_progress: 'в работе', new: 'новое' }

/**
 * План на сегодня: главный шаг и один рекомендуемый формат; остальные — под раскрытием.
 * «Сделано» — только по результатам в прогрессе; пропуски и скрытые темы — личные настройки браузера.
 */
export function TodayPlan({ next, complete }: { next: NextAction | undefined; complete: boolean }) {
  const { curriculum, progress } = useStore()
  const now = useNow()
  const [prefs, setPrefs] = useLocalState<DailyPrefs>('today.daily', EMPTY_DAILY_PREFS)
  const [moreOpen, setMoreOpen] = useLocalState('today.morePractice', false)
  const items = dailySet(curriculum, progress, now, prefs)
  const recommended = recommendedDailyItem(items, now)
  const more = items.filter((item) => item !== recommended)
  const done = dailyDoneCount(items)
  const day = dayKey(now)
  const active = todayIncident(curriculum, progress, now)

  const skip = (id: string) => setPrefs({ ...prefs, skipped: { day, ids: [...(prefs.skipped.day === day ? prefs.skipped.ids : []), id] } })
  const hide = (topic: string) => setPrefs({ ...prefs, hidden: [...new Set([...prefs.hidden, topic])] })
  const unhide = (topic: string) => setPrefs({ ...prefs, hidden: prefs.hidden.filter((t) => t !== topic) })
  const renderItem = (item: DailyItem, n: number) => (
    <PlanItem
      key={item.kind}
      n={n}
      item={item}
      note={item.kind === 'incident' && active.current?.incident.id === item.id && active.current.passedChecks !== null ? `последняя проверка: ${active.current.passedChecks} из ${active.current.incident.checks.length}` : undefined}
      onSkip={() => skip(item.id)}
      onHide={() => hide(item.topic)}
    />
  )

  return (
    <section aria-labelledby="today-plan" className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-plan" className="text-lg font-semibold text-fg">
          План на сегодня
        </h2>
        {items.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            Форматов: сделано {done} из {items.length}
            <InfoTip label="Что сделано сегодня">
              Считаются форматы практики текущего плана, включая свёрнутые: ответ в тренажёре,
              оценённый ответ «Своими словами», успешная проверка инцидента или полная сессия зала сегодня.
              Главный шаг программы сюда не входит. Пропуск и скрытие темы ничего не засчитывают.
            </InfoTip>
          </span>
        )}
      </div>
      <ol className="space-y-3">
        <MainStep next={next} complete={complete} />
        {recommended && renderItem(recommended, 2)}
      </ol>
      {!recommended && (
        <p className="mt-3 text-sm text-muted">
          {items.length ? 'Практика плана на сегодня сделана.' : 'Нет практики в плане. Верните скрытую тему или откройте всю практику.'}
        </p>
      )}
      {more.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls="today-more-practice"
            onClick={() => setMoreOpen(!moreOpen)}
            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg"
          >
            <ChevronDown size={15} className={`transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
            Ещё практика · {more.length}
          </button>
          <ol id="today-more-practice" hidden={!moreOpen} start={recommended ? 3 : 2} className="mt-3 space-y-3">
            {more.map((item, i) => renderItem(item, i + (recommended ? 3 : 2)))}
          </ol>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
        {active.total > 1 && (
          <a href={buildHash('incidents')} className="hover:text-accent">
            Инцидентов в работе: {active.total}
          </a>
        )}
        {prefs.hidden.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5">
            Скрыто:
            {prefs.hidden.map((topic) => (
              <button
                key={topic}
                type="button"
                onClick={() => unhide(topic)}
                title="Вернуть тему в план"
                className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 hover:text-accent"
              >
                {dailyTopicTitle(curriculum, topic)} <X size={11} />
              </button>
            ))}
          </span>
        )}
      </div>
    </section>
  )
}

function MainStep({ next, complete }: { next: NextAction | undefined; complete: boolean }) {
  const { idx } = useStore()
  const verify = next?.type === 'verify'
  const track = next && idx.trackById.get(next.task.trackId)
  return (
    <li className={`flex gap-4 rounded-2xl border p-5 sm:p-6 ${verify ? 'border-warn/35 bg-warn/[0.06]' : 'border-accent/30 bg-accent/[0.06]'}`}>
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold ${verify ? 'border-warn text-warn' : 'border-accent text-accent'}`}>1</span>
      <div className="min-w-0 flex-1">
        <div className={`text-xs font-semibold tracking-wider uppercase ${verify ? 'text-warn' : 'text-accent'}`}>
          {verify ? 'Довести до зачёта' : next?.type === 'continue' ? 'Продолжить' : 'Главный шаг'}
          {track && ` · ${track.code} · ${track.title}`}
          {next && ` · ${KIND_LABEL[next.task.kind].toLowerCase()}`}
        </div>
        <h3 className="mt-1.5 text-xl leading-snug font-semibold text-fg sm:text-[22px]">{next ? next.task.title : complete ? 'Основная программа засчитана' : 'Сейчас нет доступной задачи'}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          {next ? next.reason : complete ? 'Дальше — стенды и повторение: они удерживают знания и превращают их в навык.' : 'Посмотрите блокировки и предыдущие задачи в дорожной карте. Практика ниже доступна.'}
        </p>
        {next?.why && (
          <div className="mt-2 flex items-center justify-between gap-1.5 text-xs text-muted">
            Почему этот шаг <InfoTip label="Почему этот шаг">{next.why}</InfoTip>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
          {next && (
            <Button variant="primary" size="lg" onClick={() => setTaskParam(next.task.id)}>
              {verify ? 'Проверить критерии' : next.type === 'continue' ? 'Продолжить задачу' : 'Начать задачу'} <ArrowRight size={16} />
            </Button>
          )}
          <a className="text-sm text-muted hover:text-accent" href={buildHash('roadmap')}>
            Дорожная карта
          </a>
        </div>
      </div>
    </li>
  )
}

function PlanItem({ n, item, note, onSkip, onHide }: { n: number; item: DailyItem; note?: string; onSkip: () => void; onHide: () => void }) {
  const Icon = ICON[item.kind]
  const tone = TONE_TEXT[FORMAT_TONE[item.kind]]
  const done = item.status === 'done'
  const href = buildHash(item.link.page, item.link.params)
  return (
    <li className="flex gap-4 rounded-2xl bg-surface p-4 shadow-card sm:p-5">
      {done ? (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ok/15 text-ok" aria-label="Сделано">
          <Check size={16} />
        </span>
      ) : (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-line text-sm text-muted">{n}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className={`inline-flex items-center gap-1 font-semibold tracking-wider uppercase ${tone}`}>
            <Icon size={12} /> {FORMAT_LABEL[item.kind]}
          </span>
          <span className="min-w-0 truncate text-muted">{item.topicTitle.replace(/^(Упражнения|DevOps-база|MLOps-база|Инциденты|Залы) · /, '')}</span>
          <span className={item.status === 'due' ? 'text-warn' : done ? 'text-ok' : 'text-subtle'}>· {STATUS[item.status]}</span>
        </div>
        <a href={href} className={`mt-1 line-clamp-2 block leading-snug hover:text-accent ${done ? 'text-muted' : 'text-fg'}`}>
          {item.title}
        </a>
        {note && <div className="mt-1 text-xs text-muted">{note}</div>}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <a href={href} className={`inline-flex items-center gap-1 font-semibold hover:underline ${tone}`}>
            {done ? 'Открыть ещё раз' : item.status === 'in_progress' ? 'Продолжить' : OPEN[item.kind]} <ArrowRight size={12} />
          </a>
          {!done && (
            <>
              <button type="button" onClick={onSkip} className="inline-flex items-center gap-1 text-subtle hover:text-accent" title="Сегодня показать другое задание этого формата">
                <SkipForward size={12} /> Пропустить
              </button>
              <button type="button" onClick={onHide} className="inline-flex items-center gap-1 text-subtle hover:text-accent" title="Не предлагать задания этой темы, пока не вернёте">
                <EyeOff size={12} /> Скрыть тему
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  )
}
