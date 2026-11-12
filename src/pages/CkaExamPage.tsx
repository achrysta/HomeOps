import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  beginExamOperation,
  endExamOperation,
  examOperationBusy,
  subscribeExamOperations,
} from '../lib/ckaExamRuntime'
import { CKA_EXAM_VARIANTS } from '../data/ckaExams'
import { CKA_EXAM_POLICY } from '../config/learning'
import { examActive, examDeadline, examLate, examResult, examStands } from '../lib/ckaExam'
import { prepareExam, stopExam, verifyExam } from '../lib/ckaExamActions'
import { requestReportsRefresh } from '../lib/labs'
import { uid } from '../lib/storage'
import { CKA_DOMAIN_LABEL } from '../lib/labels'
import { useStore } from '../state/context'
import { useLabsStatus } from '../state/useLabsStatus'
import { buildHash, useRoute } from '../state/router'
import { CkaExamWorkspace } from '../components/CkaExamWorkspace'
import { Badge, Button, Card, PageHeader, ProgressBar } from '../components/ui'
import type { CkaExamAttempt, IncidentDef } from '../types'

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`
const date = (at: string) =>
  new Date(at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })

export function CkaExamPage() {
  const { curriculum, progress, dispatch } = useStore()
  const { params } = useRoute()
  const [labs] = useLabsStatus(10_000)
  const attempts = progress.ckaExams ?? []
  const attempt =
    attempts.findLast(examActive) ?? attempts.find((a) => a.id === params.get('attempt'))
  const [variantId, setVariantId] = useState<string>(CKA_EXAM_VARIANTS[0].id)
  const [acknowledged, setAcknowledged] = useState(false)
  const [localBusy, setBusy] = useState(false)
  const remoteBusy = useSyncExternalStore(subscribeExamOperations, () =>
    examOperationBusy(attempt?.id ?? ''),
  )
  const busy = localBusy || remoteBusy
  const busyRef = useRef(false)
  const [log, setLog] = useState('')
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const logChunk = useCallback((text: string) => setLog((old) => (old + text).slice(-18_000)), [])
  const save = useCallback(
    (a: CkaExamAttempt) => dispatch({ type: 'cka-exam/upsert', attempt: a }),
    [dispatch],
  )

  const start = async (existing?: CkaExamAttempt) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setLog('')
    setMessage('')
    const pending: CkaExamAttempt = existing ?? {
      id: uid(),
      variantId,
      createdAt: new Date().toISOString(),
      phase: 'preparing',
      reports: {},
    }
    if (!beginExamOperation(pending.id)) {
      busyRef.current = false
      setBusy(false)
      return
    }
    save({ ...pending, error: undefined })
    window.location.hash = buildHash('incidents', { view: 'exam', attempt: pending.id })
    try {
      await prepareExam(examStands(pending.variantId, curriculum.incidents), logChunk)
      save({ ...pending, phase: 'running', startedAt: new Date().toISOString(), error: undefined })
    } catch (error) {
      save({
        ...pending,
        error:
          error instanceof Error ? error.message : 'Подготовка не завершена. Повторите запуск.',
      })
    } finally {
      endExamOperation(pending.id)
      busyRef.current = false
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!attempt?.startedAt || busyRef.current || !['running', 'checking'].includes(attempt.phase))
      return
    if (!beginExamOperation(attempt.id)) return
    busyRef.current = true
    setBusy(true)
    setLog('')
    setMessage('')
    const pending: CkaExamAttempt = {
      ...attempt,
      phase: 'checking',
      submittedAt: new Date().toISOString(),
      error: undefined,
    }
    save(pending)
    try {
      const reports = await verifyExam(
        examStands(attempt.variantId, curriculum.incidents),
        attempt.startedAt,
        logChunk,
      )
      save({ ...pending, reports, phase: 'finished', finishedAt: new Date().toISOString() })
      requestReportsRefresh()
    } catch (error) {
      save({
        ...pending,
        error: error instanceof Error ? error.message : 'Сдача не завершена. Повторите проверку.',
      })
    } finally {
      endExamOperation(attempt.id)
      busyRef.current = false
      setBusy(false)
    }
  }

  const stop = async () => {
    if (!attempt || busyRef.current) return
    if (!beginExamOperation(attempt.id)) return
    busyRef.current = true
    setBusy(true)
    setMessage('')
    setLog('')
    try {
      await stopExam(examStands(attempt.variantId, curriculum.incidents), logChunk)
      if (examActive(attempt)) save({ ...attempt, phase: 'cancelled', error: undefined })
      setMessage('Стенды экзамена остановлены.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Остановка не завершена. Повторите.')
    } finally {
      endExamOperation(attempt.id)
      busyRef.current = false
      setBusy(false)
    }
  }
  const stands = examStands(attempt?.variantId ?? variantId, curriculum.incidents)
  const selected = stands.find((d) => d.id === params.get('id')) ?? stands[0]
  const expired = !!attempt?.startedAt && now >= examDeadline(attempt)
  const remaining = attempt?.startedAt
    ? Math.max(0, Math.ceil((examDeadline(attempt) - now) / 1000))
    : CKA_EXAM_POLICY.minutes * 60
  const time = `${String(Math.floor(remaining / 3600)).padStart(2, '0')}:${String(Math.floor(remaining / 60) % 60).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`
  return (
    <div>
      <PageHeader
        eyebrow="Практика · Kubernetes"
        title="Экзамен по стендам"
        description={`Задач: ${stands.length}. Два часа, без подсказок и разбора. Результат по проверкам и доменам CKA.`}
      />
      <a className="mb-5 inline-block text-sm text-accent" href={buildHash('incidents')}>
        К списку инцидентов
      </a>
      {attempt ? (
        <div className="space-y-5">
          <Card
            title={CKA_EXAM_VARIANTS.find((v) => v.id === attempt.variantId)?.title}
            action={
              <Badge tone={expired ? 'warn' : 'accent'}>
                {attempt.phase === 'running'
                  ? time
                  : attempt.phase === 'preparing'
                    ? 'Подготовка'
                    : attempt.phase === 'checking'
                      ? 'Проверка'
                      : attempt.phase === 'cancelled'
                        ? 'Отменён'
                        : examLate(attempt)
                          ? 'После времени'
                          : 'Сдан в пределах времени'}
              </Badge>
            }
          >
            {attempt.phase === 'preparing' && (
              <p className="mb-3 text-sm text-muted">
                Таймер начнётся после сброса и запуска всех стендов. Если страница была
                перезагружена, повторите подготовку: стенды будут снова сброшены.
              </p>
            )}
            {attempt.phase === 'checking' && (
              <p className="mb-3 text-sm text-muted">
                Проверяем итоговое состояние. После перезагрузки страницы или сбоя сервиса можно
                повторить сдачу.
              </p>
            )}
            {expired && examActive(attempt) && (
              <p className="mb-3 text-sm text-warn">
                Время вышло. Повторная сдача доступна и будет отмечена «после времени».
              </p>
            )}
            {attempt.error && (
              <p role="alert" className="mb-3 text-sm text-warn">
                {attempt.error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {attempt.phase === 'preparing' && (
                <Button disabled={busy} onClick={() => void start(attempt)}>
                  {busy ? 'Готовим стенды…' : 'Повторить подготовку'}
                </Button>
              )}
              {['running', 'checking'].includes(attempt.phase) && (
                <Button disabled={busy} onClick={() => void submit()}>
                  {busy
                    ? 'Проверяем стенды…'
                    : attempt.phase === 'checking'
                      ? 'Повторить сдачу'
                      : 'Сдать экзамен'}
                </Button>
              )}
              <Button variant="secondary" disabled={busy} onClick={() => void stop()}>
                {examActive(attempt)
                  ? 'Прервать и остановить стенды'
                  : 'Остановить стенды экзамена'}
              </Button>
              {!examActive(attempt) && (
                <a
                  className="self-center text-sm text-accent"
                  href={buildHash('incidents', { view: 'exam' })}
                >
                  Выбрать новый вариант
                </a>
              )}
            </div>
            {message && (
              <p role="status" className="mt-3 text-sm text-muted">
                {message}
              </p>
            )}
            {log && (
              <details className="mt-4" open={busy || !!attempt.error}>
                <summary className="cursor-pointer text-xs text-muted">Вывод действий</summary>
                <pre className="mt-2 max-h-60 overflow-y-auto rounded-lg bg-term p-3 text-xs whitespace-pre-wrap wrap-anywhere text-[#d1d9e0]">
                  {log}
                </pre>
              </details>
            )}
          </Card>
          {attempt.phase === 'finished' ? (
            <ExamResult attempt={attempt} defs={curriculum.incidents} />
          ) : (
            examActive(attempt) && (
              <>
                <div className="flex flex-wrap gap-2" aria-label="Задачи экзамена">
                  {stands.map((d, index) => (
                    <a
                      key={d.id}
                      aria-current={d.id === selected?.id ? 'page' : undefined}
                      className={`rounded-lg px-3 py-2 text-xs ${d.id === selected?.id ? 'bg-accent/15 text-accent' : 'bg-surface text-muted'}`}
                      href={buildHash('incidents', { view: 'exam', id: d.id, attempt: attempt.id })}
                    >
                      {index + 1} · {d.title}
                    </a>
                  ))}
                </div>
                {selected && (
                  <Card
                    title={selected.title}
                    subtitle={`≈ ${selected.minutes} мин · ${selected.cka?.map((id) => CKA_DOMAIN_LABEL[id].title).join(' · ')}`}
                  >
                    <h3 className="mb-2 text-sm font-semibold">Условие</h3>
                    <p className="text-sm leading-relaxed text-muted">{selected.scenario}</p>
                    <h3 className="mt-4 mb-2 text-sm font-semibold">Цель</h3>
                    <p className="text-sm leading-relaxed text-muted">{selected.goal}</p>
                    {!!selected.constraints?.length && (
                      <>
                        <h3 className="mt-4 mb-2 text-sm font-semibold">Ограничения</h3>
                        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                          {selected.constraints.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    <CkaExamWorkspace
                      key={selected.id}
                      def={selected}
                      labs={labs}
                      locked={attempt.phase !== 'running' || busy || expired}
                    />
                  </Card>
                )}
              </>
            )
          )}
        </div>
      ) : (
        <Card
          title="Выберите вариант"
          subtitle="В каждом варианте — все пять доменов. Вес домена учитывается в общем балле."
        >
          <div className="mb-5 grid gap-2 sm:grid-cols-3">
            {CKA_EXAM_VARIANTS.map((v) => (
              <button
                type="button"
                key={v.id}
                aria-pressed={variantId === v.id}
                className={`rounded-lg px-4 py-3 text-left text-sm ${variantId === v.id ? 'bg-accent/12 text-accent ring-1 ring-accent/30' : 'bg-surface-2 text-muted'}`}
                onClick={() => setVariantId(v.id)}
              >
                {v.title} ·{' '}
                {examStands(v.id, curriculum.incidents).reduce((n, d) => n + d.minutes, 0)} мин
              </button>
            ))}
          </div>
          <ul className="mb-5 space-y-2 text-sm text-muted">
            {stands.map((d) => (
              <li key={d.id}>
                {d.title} · {d.minutes} мин
              </li>
            ))}
          </ul>
          <label className="mb-4 flex items-start gap-3 rounded-lg bg-warn/10 p-3 text-sm text-fg">
            <input
              className="mt-1 shrink-0 accent-accent"
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>
              Стенды варианта будут сброшены, ваши правки в них пропадут. Начать новый экзамен?
            </span>
          </label>
          <Button disabled={!acknowledged || busy || !labs?.ok} onClick={() => void start()}>
            Начать экзамен
          </Button>
          {!labs?.ok && (
            <p role="status" className="mt-3 text-sm text-warn">
              {labs === undefined
                ? 'Проверяем сервис стендов…'
                : 'Сервис стендов недоступен. Проверьте контейнер labs и дождитесь ответа.'}
            </p>
          )}
        </Card>
      )}
      <p className="mt-5 max-w-3xl text-xs leading-relaxed text-muted">
        Проверки каждого стенда равны по весу. Балл домена — средняя доля пройденных проверок его
        стендов; общий балл учитывает веса CKA. Один стенд может относиться к нескольким доменам.{' '}
        <a
          className="text-accent hover:underline"
          href="https://docs.linuxfoundation.org/tc-docs/certification/faq-cka-ckad-cks"
          target="_blank"
          rel="noreferrer"
        >
          66% на настоящем CKA
        </a>{' '}
        — только ориентир: этот набор не воспроизводит сертификационный экзамен. Попытка не
        увеличивает прогресс программы; успешная автопроверка сохраняет честное решение инцидента.
      </p>
      {!!attempts.length && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">История попыток</h2>
          <div className="space-y-2">
            {[...attempts].reverse().map((a) => (
              <details key={a.id} className="rounded-xl bg-surface p-4 shadow-card">
                <summary className="cursor-pointer text-sm">
                  {date(a.startedAt ?? a.createdAt)} ·{' '}
                  {CKA_EXAM_VARIANTS.find((v) => v.id === a.variantId)?.title} ·{' '}
                  {a.phase === 'finished'
                    ? `${percent(examResult(a, curriculum.incidents).score)}${examLate(a) ? ' · после времени' : ''}`
                    : a.phase === 'cancelled'
                      ? 'отменён'
                      : 'не завершён'}
                </summary>
                {a.phase === 'finished' ? (
                  <div className="mt-4">
                    <ExamResult attempt={a} defs={curriculum.incidents} />
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted">{a.error ?? 'Итог ещё не получен.'}</p>
                )}
                {!attempts.some(examActive) && (
                  <a
                    className="mt-3 inline-block text-xs text-accent"
                    href={buildHash('incidents', { view: 'exam', attempt: a.id })}
                  >
                    Открыть попытку и остановку стендов
                  </a>
                )}
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ExamResult({ attempt, defs }: { attempt: CkaExamAttempt; defs: IncidentDef[] }) {
  const result = examResult(attempt, defs)
  const weak = [...result.domains]
    .filter((d) => d.fraction < 1)
    .sort((a, b) => a.fraction - b.fraction)
    .slice(0, 2)
  return (
    <Card
      title={`Результат · ${percent(result.score)}`}
      subtitle={examLate(attempt) ? 'Сдано после окончания времени' : 'Сдано в пределах времени'}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {result.domains.map((d) => (
          <div key={d.id}>
            <div className="mb-2 text-xs font-medium text-fg">
              {d.title} · {d.weight}%
            </div>
            <ProgressBar
              value={d.fraction}
              tone={d.fraction < CKA_EXAM_POLICY.referencePercent / 100 ? 'warn' : 'ok'}
            />
            <p className="mt-1 text-xs text-muted">
              {percent(d.fraction)} · {d.count} стенд(а)
            </p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">
        {weak.length
          ? `Сначала повторить: ${weak.map((d) => `${d.title} (${percent(d.fraction)})`).join(', ')}. Раскройте задачи ниже — там видны оставшиеся проверки.`
          : 'Все проверки пройдены по всем доменам.'}
      </p>
      <div className="mt-5 space-y-3">
        {result.stands.map((s) => (
          <details key={s.def.id}>
            <summary className="cursor-pointer text-sm text-fg">
              {s.def.title} · {s.passed} / {s.total} · {percent(s.fraction)}
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {s.def.checks.map((c) => {
                const check = s.report?.checks.find((x) => x.id === c.id)
                return (
                  <li key={c.id}>
                    <span className={check?.ok ? 'text-ok' : 'text-warn'}>
                      {check?.ok ? '✓' : '○'}
                    </span>{' '}
                    {c.title}
                    {check?.message ? `: ${check.message}` : ''}
                  </li>
                )
              })}
            </ul>
          </details>
        ))}
      </div>
    </Card>
  )
}
