import { ArrowLeft, CheckCircle2, CircleStop, Lightbulb, Loader2, Pause, Play, SquareTerminal, Timer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CopyCommand } from '../components/CopyCommand'
import { TerminalWorkspace } from '../components/TerminalWorkspace'
import { Badge, Button, Card, InfoTip, PageHeader } from '../components/ui'
import { GYM_POLL_MS } from '../config/weights'
import { activeSession, bestSeconds, currentRep, formatSeconds, gymCommands, gymDueAt, gymState, isFullSession, sessionSeconds, type GymState } from '../lib/gyms'
import { CKA_DOMAIN_LABEL, plural } from '../lib/labels'
import { fetchLiveCheck, runLabAction, standState, type LabAction, type LiveCheckResult } from '../lib/labs'
import { useStore } from '../state/context'
import { buildHash, useRoute } from '../state/router'
import { useLabsStatus } from '../state/useLabsStatus'
import { useNow } from '../state/useNow'
import type { GymDef, GymProgress } from '../types'
import { ReportIssue } from '../components/ReportIssue'
import { StandsTabs } from '../components/SectionTabs'

const STATE_TONE: Record<GymState, 'neutral' | 'warn' | 'info' | 'ok'> = { new: 'neutral', due: 'warn', active: 'info', scheduled: 'ok', paused: 'neutral' }

function stateLabel(state: GymState, dueAt: number | null, now: number): string {
  if (state === 'new') return 'Ещё не проходили'
  if (state === 'due') return 'Пора пройти'
  if (state === 'active') return 'Идёт сессия'
  if (state === 'paused') return 'На паузе'
  const days = Math.max(1, Math.ceil(((dueAt ?? now) - now) / 86_400_000))
  return `Через ${plural(days, 'день', 'дня', 'дней')}`
}

const fmtDate = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Залы: короткие подходы в терминале стенда с автоматическим зачётом по живой проверке. */
export function GymsPage() {
  const { params } = useRoute()
  const { curriculum } = useStore()
  const def = curriculum.gyms.find((g) => g.id === params.get('id'))
  return def ? <GymDetail key={def.id} def={def} /> : <GymList />
}

function GymList() {
  const { curriculum, progress, dispatch } = useStore()
  const now = useNow()
  return (
    <div>
      <PageHeader eyebrow="Практика"
        title="Залы"
        actions={<StandsTabs active="gyms" />}
        description={
          <>
            Короткие подходы в терминале стенда — подход засчитывается сам, без кнопки «Проверить».{' '}
            <InfoTip label="Как устроены залы">Подход засчитывается, как только состояние кластера стало нужным. Зал возвращается через 1, 3, 7, 14 и 30 дней. На прогресс обучения не влияет: это тренировка беглости, как тренажёр.</InfoTip>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {curriculum.gyms.map((g) => {
          const gp = progress.gyms[g.id]
          const state = gymState(g, gp, now)
          const best = bestSeconds(g, gp)
          const last = gp?.sessions.at(-1)
          return (
            <Card key={g.id}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Timer size={14} className="text-accent" /> {g.topic} · {plural(g.reps.length, 'подход', 'подхода', 'подходов')} · ≈ {g.minutes} мин
                <Badge tone={STATE_TONE[state]}>{stateLabel(state, gymDueAt(g, gp), now)}</Badge>
              </div>
              <a href={buildHash('gyms', { id: g.id })} className="mt-2 block text-base font-semibold text-fg hover:text-accent">
                {g.title}
              </a>
              <p className="mt-1 text-xs leading-relaxed text-muted">{g.description}</p>
              {g.cka && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {g.cka.map((d) => (
                    <Badge key={d}>CKA · {CKA_DOMAIN_LABEL[d].title}</Badge>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                <a href={buildHash('gyms', { id: g.id })} className="font-medium text-accent hover:underline">
                  {state === 'active' ? 'Продолжить сессию' : 'Открыть зал'} →
                </a>
                {last && <span className="text-muted">последняя: {fmtDate(last.startedAt)}</span>}
                {best !== null && <span className="text-muted">лучшее время: {formatSeconds(best)}</span>}
                <button type="button" onClick={() => dispatch({ type: 'gym/pause', gymId: g.id, paused: !gp?.paused })} className="inline-flex items-center gap-1 text-muted hover:text-accent">
                  {gp?.paused ? <Play size={12} /> : <Pause size={12} />} {gp?.paused ? 'Снять с паузы' : 'На паузу'}
                </button>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function GymDetail({ def }: { def: GymDef }) {
  const { progress, dispatch } = useStore()
  const gp: GymProgress | undefined = progress.gyms[def.id]
  const now = useNow()
  const session = activeSession(gp)
  const rep = currentRep(def, session)
  const [labs, refresh] = useLabsStatus(session ? 4000 : 8000)
  const [busy, setBusy] = useState<LabAction | null>(null)
  const [log, setLog] = useState<{ text: string; code: number | null } | null>(null)
  const [live, setLive] = useState<LiveCheckResult | null>(null)
  const [terminal, setTerminal] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [clock, setClock] = useState(() => Date.now())

  const containers = labs?.incidents[def.id]?.containers ?? []
  const running = standState(containers) === 'running'
  const last = gp?.sessions.at(-1)
  const justFinished = !session && last?.finishedAt && isFullSession(def, last) && now - Date.parse(last.finishedAt) < 30 * 60_000

  // Живая проверка текущего подхода: пока идёт сессия и стенд работает
  useEffect(() => {
    if (!session || !running || busy) return
    let stopped = false
    const tick = async () => {
      const r = await fetchLiveCheck(def.id)
      if (stopped) return
      setLive(r)
      const current = currentRep(def, session)
      if (r.kind === 'ok' && current && r.checks.find((c) => c.id === current.id)?.ok) {
        dispatch({ type: 'gym/rep', def, sessionId: session.id, repId: current.id })
      }
    }
    void tick()
    const timer = setInterval(() => document.visibilityState === 'visible' && void tick(), GYM_POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [def, session, running, busy, dispatch])

  // Секундомер сессии
  useEffect(() => {
    if (!session) return
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [session])

  const act = async (action: LabAction): Promise<number> => {
    setBusy(action)
    setLog({ text: '', code: null })
    try {
      const code = await runLabAction(def.id, action, undefined, (chunk) => setLog((l) => ({ text: ((l?.text ?? '') + chunk).slice(-30_000), code: null })))
      setLog((l) => ({ text: l?.text ?? '', code }))
      return code
    } finally {
      setBusy(null)
      refresh()
    }
  }

  // Новая сессия — всегда с чистого состояния: запуск стенда или его пересоздание
  const start = async () => {
    setLive(null)
    setHint(null)
    const code = await act(running ? 'reset' : 'up')
    if (code === 0) dispatch({ type: 'gym/start', gymId: def.id })
  }
  const stop = async () => {
    if (session) dispatch({ type: 'gym/finish', gymId: def.id, sessionId: session.id })
    setTerminal(false)
    await act('down')
  }

  const liveMessage = rep && live?.kind === 'ok' ? live.checks.find((c) => c.id === rep.id)?.message : undefined
  const elapsed = session ? sessionSeconds(session, clock) : 0

  return (
    <div>
      <a href={buildHash('gyms')} className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-accent">
        <ArrowLeft size={12} /> Все залы
      </a>
      <PageHeader
        eyebrow={`Зал · ${def.topic}`}
        title={def.title}
        description={`${def.description} Где работать: ${def.where}.`}
        actions={<ReportIssue kind="gym" targetId={def.id} targetTitle={def.title} />}
      />

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="min-w-0 space-y-5 lg:col-span-3">
          <Card
            title={session ? `Сессия идёт · ${formatSeconds(elapsed)}` : justFinished ? `Сессия пройдена за ${formatSeconds(sessionSeconds(last))}` : 'Подходы'}
            subtitle={
              session
                ? 'Делайте подходы по порядку в терминале зала: текущий засчитается сам, как только состояние станет нужным'
                : justFinished
                  ? `Зал вернётся ${gymDueAt(def, gp) ? new Date(gymDueAt(def, gp)!).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : 'по расписанию'}. Новая сессия начнётся с чистого стенда.`
                  : `${plural(def.reps.length, 'подход', 'подхода', 'подходов')} по порядку. Сессия начинается с чистого стенда.`
            }
          >
            <ol className="space-y-2">
              {def.reps.map((r, i) => {
                const doneAt = session?.reps[r.id] ?? (justFinished ? last?.reps[r.id] : undefined)
                const isCurrent = !!session && rep?.id === r.id
                const prevAt = i === 0 ? (session ?? last)?.startedAt : (session ?? last)?.reps[def.reps[i - 1].id]
                return (
                  <li key={r.id} className={`rounded-md border px-3 py-2.5 ${isCurrent ? 'border-accent/50 bg-accent/5' : 'border-line'}`}>
                    <div className="flex items-start gap-2.5">
                      {doneAt ? (
                        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ok" />
                      ) : (
                        <span className={`mt-0.5 w-4 shrink-0 text-center font-mono text-xs ${isCurrent ? 'text-accent' : 'text-subtle'}`}>{i + 1}</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-fg">
                          {r.title}
                          {doneAt && prevAt && <span className="font-mono text-xs font-normal text-muted">{formatSeconds(Math.max(0, Math.round((Date.parse(doneAt) - Date.parse(prevAt)) / 1000)))}</span>}
                        </div>
                        {(isCurrent || !session) && <p className={`mt-1 text-sm leading-relaxed ${isCurrent ? 'text-fg' : 'text-muted'}`}>{r.task}</p>}
                        {isCurrent && (
                          <div className="mt-2 space-y-2">
                            <div className="flex items-start gap-1.5 text-xs text-muted">
                              <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin" />
                              <span>
                                {!running ? 'Стенд не запущен — начните сессию заново.' : live?.kind === 'error' ? `Проверка не удалась: ${live.error}` : liveMessage ? `Пока: ${liveMessage}` : 'Проверяю состояние каждые несколько секунд…'}
                              </span>
                            </div>
                            {hint === r.id ? (
                              <p className="rounded-md border border-line bg-surface-2/50 px-3 py-2 font-mono text-xs leading-relaxed break-words text-fg">{r.hint}</p>
                            ) : (
                              <button type="button" onClick={() => setHint(r.id)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent">
                                <Lightbulb size={12} /> Подсказка
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          </Card>

          {terminal && running && (
            <TerminalWorkspace
              id={def.id}
              kind={def.topic === 'Linux' ? 'server' : def.topic === 'Kubernetes' ? 'cluster' : 'compose'}
              task={rep ? { title: rep.title, goal: rep.task } : { title: def.title, goal: def.description }}
              onClose={() => setTerminal(false)}
            />
          )}
        </div>

        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card
            title="Стенд зала"
            subtitle={
              def.topic === 'Linux'
                ? 'Учебный сервер с systemd в контейнере. Новая сессия пересоздаёт сервер с исходным состоянием.'
                : def.topic === 'MLflow'
                  ? 'MLflow и терминал в Docker Compose. Новая сессия готовит новые учебные run; веса модели не скачиваются.'
                : def.topic === 'Airflow'
                  ? 'Airflow 3 standalone и терминал в Docker Compose. REST API v2; новая сессия очищает учебные run и результаты.'
                : def.topic === 'LLM API'
                  ? 'Два локальных CPU-провайдера и gateway. Без внешней сети и весов; задержки и ошибки синтетические.'
                : 'Рабочее место с kubectl в общем кластере kind. Первый запуск создаёт кластер — 1–3 минуты.'
            }
          >
            {labs === undefined ? (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Loader2 size={14} className="animate-spin" /> Проверяю сервис стендов…
              </div>
            ) : !labs?.ok ? (
              <div className="space-y-3">
                <p className="text-sm text-muted">{labs?.error ?? 'Сервис стендов не отвечает. Подходы засчитывает дашборд через него — запустите дашборд командой docker compose up -d в папке проекта.'}</p>
                <p className="text-xs text-subtle">Потренироваться можно и командами — живая проверка покажет, какие подходы готовы, но в историю зала они не попадут.</p>
                <div className="grid gap-2">
                  {gymCommands(def).map((c) => (
                    <CopyCommand key={c.cmd} label={c.label} cmd={c.cmd} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Badge tone={running ? 'ok' : 'neutral'}>{running ? 'Запущен' : 'Остановлен'}</Badge>
                <div className="flex flex-wrap gap-2">
                  {session ? (
                    <Button variant="primary" size="sm" disabled={!!busy} onClick={() => dispatch({ type: 'gym/finish', gymId: def.id, sessionId: session.id })}>
                      Завершить сессию
                    </Button>
                  ) : (
                    <Button variant="primary" size="sm" disabled={!!busy} onClick={start}>
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} {running ? 'Начать сессию заново' : 'Начать сессию'}
                    </Button>
                  )}
                  {running && (
                    <Button size="sm" disabled={!!busy} onClick={() => setTerminal(!terminal)}>
                      <SquareTerminal size={13} /> {terminal ? 'Скрыть терминал' : 'Терминал'}
                    </Button>
                  )}
                  {running && (
                    <Button size="sm" variant="ghost" disabled={!!busy} onClick={stop}>
                      <CircleStop size={13} /> Остановить
                    </Button>
                  )}
                </div>
                {log && (
                  <details open={log.code === null || log.code !== 0} className="text-xs">
                    <summary className="cursor-pointer text-muted">{log.code === null ? 'Выполняется…' : log.code === 0 ? 'Готово' : `Ошибка (код ${log.code})`}</summary>
                    <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted">{log.text || '…'}</pre>
                  </details>
                )}
              </div>
            )}
          </Card>

          <Card title="История" subtitle={gp?.paused ? 'Зал на паузе — по расписанию не приходит' : stateLabel(gymState(def, gp, now), gymDueAt(def, gp), now)}>
            {gp?.sessions.length ? (
              <ul className="space-y-1.5 text-xs">
                {[...gp.sessions].reverse().slice(0, 8).map((s) => {
                  const done = def.reps.filter((r) => s.reps[r.id]).length
                  return (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-muted">{fmtDate(s.startedAt)}</span>
                      <span className={isFullSession(def, s) ? 'text-ok' : 'text-muted'}>
                        {done}/{def.reps.length} · {s.finishedAt ? formatSeconds(sessionSeconds(s)) : 'идёт'}
                        {s.finishedAt && !isFullSession(def, s) ? ' · прервана' : ''}
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">Сессий ещё не было.</p>
            )}
            <button type="button" onClick={() => dispatch({ type: 'gym/pause', gymId: def.id, paused: !gp?.paused })} className="mt-3 inline-flex items-center gap-1 text-xs text-muted hover:text-accent">
              {gp?.paused ? <Play size={12} /> : <Pause size={12} />} {gp?.paused ? 'Снять с паузы' : 'Поставить на паузу'}
            </button>
          </Card>
        </div>
      </div>
    </div>
  )
}
