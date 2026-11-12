import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  Ban,
  BookOpenCheck,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Lightbulb,
  Radio,
  Siren,
  Target,
  Upload,
  XCircle,
} from 'lucide-react'
import { lazy, useEffect, useRef, useState } from 'react'
import { AsyncContent } from '../components/AsyncContent'
import { examActive } from '../lib/ckaExam'
import { IncidentStand } from '../components/IncidentStand'
import { SaveToggle } from '../components/SaveToggle'
import { Badge, Button, Card, PageHeader, Stat } from '../components/ui'
import {
  ckaCoverage,
  groupByTopic,
  incidentStatusFor,
  confirmedIncident,
  latestReport,
  parseIncidentReport,
  summarizeIncidents,
} from '../lib/incidents'
import {
  archLabel,
  CKA_DOMAIN_LABEL,
  INCIDENT_LEVEL_LABEL,
  INCIDENT_LEVEL_TONE,
  INCIDENT_STATUS_LABEL,
  INCIDENT_STATUS_TONE,
} from '../lib/labels'
import { fetchLiveCheck, standState, type LabsStatus, type LiveCheck } from '../lib/labs'
import { INCIDENT_LIVE_POLL_MS } from '../config/weights'
import { useStore } from '../state/context'
import { incidents as fullIncidents } from '../data/incidents'
import { useLabsStatus } from '../state/useLabsStatus'
import { buildHash, setSkillParam, setTaskParam, useRoute } from '../state/router'
import type { IncidentDef, Track, UserProgress } from '../types'
import { ReportIssue } from '../components/ReportIssue'
import { StandsTabs } from '../components/SectionTabs'

const INCIDENT_GROUPS: { category: IncidentDef['category']; title: string; hint: string }[] = [
  {
    category: 'mlops',
    title: 'MLOps и AI Platform',
    hint: 'Инциденты по трекам программы: сервинг LLM, gateway, метрики, RAG, eval gate, сервинг моделей.',
  },
  {
    category: 'devops',
    title: 'DevOps-база',
    hint: 'Платформенная база: Linux на учебном сервере с systemd, Docker, Kubernetes с ориентиром на экзамен CKA, PostgreSQL, Redis и CI/CD. Решённый стенд подтверждает навыки, но не меняет прогресс обучения.',
  },
]

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
const CkaExamPage = lazy(() => import('./CkaExamPage').then((m) => ({ default: m.CkaExamPage })))

function useIncidentStore() {
  const store = useStore()
  return { ...store, curriculum: { ...store.curriculum, incidents: fullIncidents } }
}

export function IncidentsPage() {
  const { params } = useRoute()
  const { curriculum, progress } = useIncidentStore()
  if (params.get('view') === 'exam' || progress.ckaExams?.some(examActive))
    return (
      <AsyncContent label="экзамен Kubernetes">
        <CkaExamPage />
      </AsyncContent>
    )
  const def = curriculum.incidents.find((d) => d.id === params.get('id'))
  return def ? <IncidentDetail key={def.id} def={def} /> : <IncidentList />
}

function IncidentList() {
  const { curriculum, idx, progress } = useIncidentStore()
  const [labs] = useLabsStatus(10_000)
  const summary = summarizeIncidents(curriculum.incidents, progress)

  return (
    <div>
      <PageHeader
        eyebrow="Практика"
        title="Инциденты"
        description="Сломанные стенды: по симптомам найдите причину и почините — как на дежурстве. Засчитывает автопроверка по итоговому состоянию, подходит любой корректный способ."
        actions={<StandsTabs active="incidents" />}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Решено"
          value={`${summary.solved} / ${summary.total}`}
          tone={summary.solved ? 'ok' : 'neutral'}
          hint={
            summary.solvedWithDebrief
              ? `из них после разбора: ${summary.solvedWithDebrief}`
              : 'по отчётам автопроверки'
          }
        />
        <Stat
          label="В работе"
          value={summary.inProgress}
          tone={summary.inProgress ? 'info' : 'neutral'}
        />
        <Stat
          label="Сервис стендов"
          value={labs === undefined ? '…' : labs?.ok ? 'работает' : 'недоступен'}
          tone={labs?.ok ? 'ok' : labs === undefined ? 'neutral' : 'warn'}
          hint={
            labs?.ok
              ? 'кнопки, логи и терминал в браузере'
              : 'стенды можно запускать командами из карточки'
          }
        />
      </div>

      <details className="mb-8 rounded-xl bg-surface px-5 py-4 text-sm shadow-card">
        <summary className="cursor-pointer font-medium text-fg">Как проходить инцидент</summary>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-muted">
          <li>Прочитайте сценарий и цель. Цель описывает итоговое состояние, а не шаги.</li>
          <li>
            Запустите стенд кнопкой. Ищите причину: терминал внутри стенда (curl, jq, dig), логи
            сервисов, Prometheus UI и другие ссылки из карточки.
          </li>
          <li>
            Исправляйте файлы в папке incidents/&lt;id&gt; в своём редакторе, перезапускайте сервисы
            — как в реальном репозитории.
          </li>
          <li>
            Нажмите «Проверить»: каждая проверка покажет, что именно ещё не так. Подсказки
            открываются по одной, разбор — после решения.
          </li>
          <li>
            В инцидентах DevOps-базы с пометкой «учебный сервер» терминал открывается прямо на
            Linux-сервере с systemd — как на VM. Проверить решение можно и командой verify в
            терминале.
          </li>
          <li>
            Kubernetes-инциденты живут в общем кластере kind (kubeadm, control-plane + worker — как
            на экзамене CKA), у каждого свой namespace. Первый запуск создаёт кластер за 1–3 минуты,
            остановка последнего стенда удаляет его и освобождает память. Работа — kubectl в
            терминале, манифесты — в incidents/&lt;id&gt;/manifests.
          </li>
        </ol>
      </details>

      {INCIDENT_GROUPS.map((group) => (
        <section key={group.category} className="mb-10">
          <h2 className="text-lg font-semibold text-fg">{group.title}</h2>
          <p className="mt-1 mb-4 max-w-3xl text-sm text-muted">{group.hint}</p>
          {groupByTopic(curriculum.incidents.filter((d) => d.category === group.category)).map(
            ([topic, defs]) => (
              <div key={topic || group.category} className="mb-6">
                {topic && (
                  <h3 className="mb-2.5 text-xs font-semibold tracking-[0.14em] text-subtle uppercase">
                    {topic}
                  </h3>
                )}
                {topic === 'Kubernetes' && <CkaCoverageRow defs={defs} progress={progress} />}
                {topic === 'Kubernetes' && (
                  <a
                    className="mb-4 inline-block rounded-lg bg-accent/10 px-4 py-3 text-sm font-medium text-accent"
                    href={buildHash('incidents', { view: 'exam' })}
                  >
                    Экзамен · 5 задач за 2 часа, без подсказок
                  </a>
                )}
                <div className="space-y-2">
                  {defs.map((d) => (
                    <IncidentRow
                      key={d.id}
                      def={d}
                      track={d.trackId ? idx.trackById.get(d.trackId) : undefined}
                      progress={progress}
                      running={
                        labs?.incidents[d.id]
                          ? standState(labs.incidents[d.id].containers) !== 'stopped'
                          : false
                      }
                    />
                  ))}
                </div>
              </div>
            ),
          )}
        </section>
      ))}
    </div>
  )
}

function IncidentRow({
  def: d,
  track,
  progress,
  running,
}: {
  def: IncidentDef
  track?: Track
  progress: UserProgress
  running: boolean
}) {
  const solved = confirmedIncident(d, progress)
  const status = incidentStatusFor(d, progress)
  return (
    <a
      href={buildHash('incidents', { id: d.id })}
      className="group flex flex-wrap items-center gap-3 rounded-xl bg-surface px-4 py-3.5 shadow-card hover:ring-1 hover:ring-accent/40 sm:px-5"
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${status === 'solved' ? 'bg-ok/12 text-ok' : status === 'in_progress' ? 'bg-info/12 text-info' : 'bg-warn/10 text-warn'}`}
      >
        {status === 'solved' ? <CheckCircle2 size={18} /> : <Siren size={17} />}
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <div className="line-clamp-2 text-sm font-medium text-fg group-hover:text-accent sm:line-clamp-none sm:truncate">
          {d.title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {track ? (
            <>
              <span className="font-mono text-accent">{track.code}</span>
              <span>{track.title}</span>
            </>
          ) : (
            <span className="text-violet">{d.topic}</span>
          )}
          {d.server && <span>учебный сервер</span>}
          {d.cka?.length ? (
            <span title="Домены экзамена CKA">
              CKA: {d.cka.map((c) => CKA_DOMAIN_LABEL[c].title).join(', ')}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Clock size={11} />≈ {d.minutes} мин
          </span>
          {running && (
            <span className="inline-flex items-center gap-1 text-ok">● стенд запущен</span>
          )}
        </div>
      </div>
      {d.interview && (
        <Badge tone="accent" title="Классическая поломка, которую стоит уметь разобрать">
          <Award size={11} /> Классика
        </Badge>
      )}
      <Badge tone={INCIDENT_LEVEL_TONE[d.level]}>{INCIDENT_LEVEL_LABEL[d.level]}</Badge>
      <Badge tone={INCIDENT_STATUS_TONE[status]}>
        {solved?.independent === false ? 'Решён с разбором' : INCIDENT_STATUS_LABEL[status]}
      </Badge>
      <ArrowRight size={14} className="text-subtle group-hover:text-accent" />
    </a>
  )
}

/** Покрытие доменов CKA Kubernetes-инцидентами: где уже есть практика, а где пока пусто. */
function CkaCoverageRow({ defs, progress }: { defs: IncidentDef[]; progress: UserProgress }) {
  return (
    <div className="mb-3 rounded-xl bg-surface-2/60 px-4 py-3 text-xs">
      <div className="mb-2 text-muted">
        Домены экзамена CKA (вес в экзамене) — инцидентов решено из доступных:
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ckaCoverage(defs, progress).map((c) => (
          <span
            key={c.domain}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${c.total ? (c.solved === c.total ? 'border-ok/40 text-ok' : 'border-line bg-surface text-fg') : 'border-dashed border-line text-subtle'}`}
            title={
              c.total
                ? `${c.solved} из ${c.total} решено`
                : 'Инцидентов по этому домену пока нет — см. TODO'
            }
          >
            {CKA_DOMAIN_LABEL[c.domain].title}{' '}
            <span className="text-subtle">{CKA_DOMAIN_LABEL[c.domain].weight}%</span>
            <span className="font-mono">{c.total ? `${c.solved}/${c.total}` : '—'}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function IncidentDetail({ def }: { def: IncidentDef }) {
  const { idx, progress } = useStore()
  const [labs, refreshLabs] = useLabsStatus(4000)
  const solved = confirmedIncident(def, progress)
  const status = incidentStatusFor(def, progress)
  const track = def.trackId ? idx.trackById.get(def.trackId) : undefined
  const toolsRef = useRef<HTMLDivElement>(null)
  const checksRef = useRef<HTMLDivElement>(null)

  return (
    <div className="space-y-6">
      <div>
        <a
          href={buildHash('incidents')}
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
        >
          <ArrowLeft size={13} /> Все инциденты
        </a>
        <div className="mb-2 text-xs font-semibold tracking-[0.14em] text-subtle uppercase">
          Инцидент · {track ? `${track.code} · ${track.title}` : `DevOps-база · ${def.topic}`}
          {def.nodeAccess ? ' · уровень кластера' : ''}
        </div>
        <h1 className="max-w-4xl text-[26px] leading-tight font-bold tracking-tight text-fg sm:text-[30px]">
          {def.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={INCIDENT_LEVEL_TONE[def.level]}>{INCIDENT_LEVEL_LABEL[def.level]}</Badge>
          <Badge tone="neutral">
            <Clock size={11} /> ≈ {def.minutes} мин
          </Badge>
          {def.cka?.map((c) => (
            <Badge
              key={c}
              tone="info"
              title={`Домен экзамена CKA, ${CKA_DOMAIN_LABEL[c].weight}% экзамена`}
            >
              CKA · {CKA_DOMAIN_LABEL[c].title}
            </Badge>
          ))}
          {def.interview && (
            <Badge tone="accent" title="Классическая поломка, которую стоит уметь разобрать">
              <Award size={11} /> Классика
            </Badge>
          )}
          <Badge tone={INCIDENT_STATUS_TONE[status]}>
            {solved?.independent === false ? 'Решён с разбором' : INCIDENT_STATUS_LABEL[status]}
          </Badge>
          <SaveToggle kind="incident" id={def.id} label />
          <ReportIssue kind="incident" targetId={def.id} targetTitle={def.title} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 xl:hidden">
          <Button
            size="sm"
            onClick={() => toolsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            К терминалу и логам
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              checksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          >
            К проверкам
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="min-w-0 space-y-4" aria-label="Условие и проверки инцидента">
          <section className="rounded-2xl border border-warn/25 bg-warn/[0.06] p-5">
            <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wider text-warn uppercase">
              <AlertTriangle size={14} /> Сценарий
            </h2>
            <p className="leading-relaxed text-fg">{def.scenario}</p>
          </section>
          <section className="rounded-2xl border border-accent/25 bg-accent/[0.06] p-5">
            <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wider text-accent uppercase">
              <Target size={14} /> Цель
            </h2>
            <p className="leading-relaxed text-fg">{def.goal}</p>
            {def.constraints && def.constraints.length > 0 && (
              <div className="mt-3 rounded-xl bg-bad/[0.07] px-3 py-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-bad uppercase">
                  <Ban size={13} /> Ограничения
                </div>
                <ul className="space-y-1 text-sm leading-relaxed text-fg">
                  {def.constraints.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="mt-3 space-y-1 text-xs leading-relaxed text-muted">
              {def.stack.map((s) => (
                <li key={s}>· {s}</li>
              ))}
            </ul>
            {def.skillIds.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                Навыки:
                {def.skillIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSkillParam(id)}
                    className="rounded-md bg-surface px-2 py-0.5 text-accent shadow-card hover:ring-1 hover:ring-accent/40"
                    title="Открыть карточку навыка"
                  >
                    {idx.skillById.get(id)?.title ?? id}
                  </button>
                ))}
              </div>
            )}
            {(def.links?.length || def.download) && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {def.links?.map((l) => (
                  <a
                    key={l.url}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    {l.label} <ExternalLink size={11} />
                  </a>
                ))}
                {def.download && <span className="text-subtle">{def.download}</span>}
              </div>
            )}
          </section>
          <div ref={checksRef} className="scroll-mt-20">
            <ChecksCard def={def} labs={labs} />
          </div>
          <HintsCard def={def} />
          <DebriefCard def={def} />
          {def.relatedTaskIds.length > 0 && (
            <Card title="Связанные задачи">
              <ul className="space-y-1">
                {def.relatedTaskIds.map((id) => {
                  const t = idx.taskById.get(id)
                  return t ? (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => setTaskParam(id)}
                        className="text-left text-sm text-fg hover:text-accent"
                      >
                        <span className="mr-2 font-mono text-xs text-subtle">{id}</span>
                        {t.title}
                      </button>
                    </li>
                  ) : null
                })}
              </ul>
            </Card>
          )}
        </div>
        <div
          ref={toolsRef}
          className="scrollbar-thin min-w-0 scroll-mt-20 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto xl:has-[[aria-modal=true]]:z-[60]"
          aria-label="Инструменты стенда"
        >
          <IncidentStand def={def} labs={labs} onChanged={refreshLabs} />
        </div>
      </div>
    </div>
  )
}

function ChecksCard({ def, labs }: { def: IncidentDef; labs: LabsStatus | null | undefined }) {
  const { curriculum, progress, dispatch } = useIncidentStore()
  const ip = progress.incidents[def.id]
  const last = latestReport(ip)
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  // Живая проверка: пока стенд с рабочим местом kubectl или учебным сервером запущен, лёгкие проверки
  // обновляются сами. Решение засчитывает только отчёт автопроверки по кнопке «Проверить».
  const liveCapable = !!(def.cluster || def.server)
  const running = liveCapable && standState(labs?.incidents[def.id]?.containers ?? []) === 'running'
  const [live, setLive] = useState<{ at: number; checks: LiveCheck[] } | null>(null)
  useEffect(() => {
    if (!running) return
    let stopped = false
    const tick = async () => {
      const r = await fetchLiveCheck(def.id)
      if (!stopped && r.kind === 'ok') setLive({ at: Date.now(), checks: r.checks })
    }
    void tick()
    const timer = setInterval(
      () => document.visibilityState === 'visible' && void tick(),
      INCIDENT_LIVE_POLL_MS,
    )
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [def.id, running])
  const liveById = new Map((running ? (live?.checks ?? []) : []).map((c) => [c.id, c]))

  const upload = async (file: File) => {
    let raw: unknown
    try {
      raw = JSON.parse(await file.text())
    } catch {
      setMessage('Файл не является JSON.')
      return
    }
    const parsed = parseIncidentReport(raw, curriculum.incidents, 'upload')
    if ('error' in parsed) return setMessage(parsed.error)
    if (parsed.incidentId !== def.id)
      return setMessage(`Это отчёт другого инцидента: ${parsed.incidentId}.`)
    dispatch({ type: 'incident/reports', reports: { [def.id]: [parsed.report] } })
    setMessage(parsed.report.passed ? 'Отчёт загружен: все проверки пройдены.' : 'Отчёт загружен.')
  }

  const okCount = last
    ? def.checks.filter((c) => last.checks.find((r) => r.id === c.id)?.ok).length
    : 0

  return (
    <Card
      title="Проверка"
      subtitle={
        last
          ? `Последняя: ${fmtTime(last.at)} · ${archLabel(last.arch)} · пройдено ${okCount} из ${def.checks.length}`
          : 'Проверок ещё не было — запустите стенд и нажмите «Проверить»'
      }
      action={
        <>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
              e.target.value = ''
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 whitespace-nowrap"
            onClick={() => fileRef.current?.click()}
            title="Загрузить .reports/last.json, если стенд работал на другом компьютере"
          >
            <Upload size={13} /> Отчёт из файла
          </Button>
        </>
      }
    >
      {confirmedIncident(def, progress) && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">
          <CheckCircle2 size={15} /> Инцидент решён{' '}
          {fmtTime(confirmedIncident(def, progress)!.report.at)}
          {confirmedIncident(def, progress)?.independent === false
            ? ' — после открытия разбора'
            : ''}
        </div>
      )}
      {liveById.size > 0 && (
        <p className="mb-3 flex items-start gap-1.5 text-xs text-muted">
          <Radio size={12} className="mt-0.5 shrink-0 text-info" />
          Пока стенд запущен, лёгкие проверки обновляются сами («сейчас»). Засчитывает решение
          только «Проверить».
        </p>
      )}
      <ul className="space-y-3">
        {def.checks.map((c) => {
          const r = last?.checks.find((x) => x.id === c.id)
          const now = liveById.get(c.id)
          return (
            <li key={c.id} className="flex gap-2.5">
              {!r ? (
                <Circle size={16} className="mt-0.5 shrink-0 text-subtle" />
              ) : r.ok ? (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ok" />
              ) : (
                <XCircle size={16} className="mt-0.5 shrink-0 text-bad" />
              )}
              <div className="min-w-0">
                <div className="text-sm text-fg">{c.title}</div>
                {r?.message && (
                  <div
                    className={`mt-0.5 text-xs leading-relaxed ${r.ok ? 'text-muted' : 'text-bad'}`}
                  >
                    {r.message}
                  </div>
                )}
                {now && (
                  <div
                    className={`mt-0.5 text-xs leading-relaxed ${now.ok ? 'text-ok' : 'text-warn'}`}
                  >
                    сейчас: {now.ok ? '✓ ' : ''}
                    {now.message}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {message && <div className="mt-3 text-xs text-muted">{message}</div>}
      {ip && ip.reports.length > 1 && (
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-muted">
            История проверок ({ip.reports.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {[...ip.reports].reverse().map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-muted">
                {r.passed ? (
                  <CheckCircle2 size={12} className="text-ok" />
                ) : (
                  <XCircle size={12} className="text-bad" />
                )}
                {fmtTime(r.at)} · {r.checks.filter((x) => x.ok).length} из {def.checks.length}
                {r.source === 'upload' ? ' · из файла' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}

function HintsCard({ def }: { def: IncidentDef }) {
  const { progress, dispatch } = useStore()
  const shown = Math.min(progress.incidents[def.id]?.hintsShown ?? 0, def.hints.length)
  return (
    <Card title="Подсказки" subtitle="Направляют поиск, но не дают решения. Открываются по одной.">
      {shown > 0 && (
        <ol className="mb-3 space-y-2">
          {def.hints.slice(0, shown).map((h, i) => (
            <li key={h} className="flex gap-2 text-sm leading-relaxed text-fg">
              <Lightbulb size={14} className="mt-1 shrink-0 text-warn" />
              <span>
                <span className="mr-1 text-xs text-subtle">{i + 1}.</span>
                {h}
              </span>
            </li>
          ))}
        </ol>
      )}
      {shown < def.hints.length ? (
        <Button
          size="sm"
          onClick={() => dispatch({ type: 'incident/hint', id: def.id, max: def.hints.length })}
        >
          <Lightbulb size={13} /> Показать подсказку {shown + 1} из {def.hints.length}
        </Button>
      ) : (
        <div className="text-xs text-subtle">Все подсказки открыты.</div>
      )}
    </Card>
  )
}

function DebriefCard({ def }: { def: IncidentDef }) {
  const { progress, dispatch } = useStore()
  const ip = progress.incidents[def.id]
  const open = !!confirmedIncident(def, progress) || !!ip?.debriefOpenedAt
  return (
    <Card
      title="Разбор"
      subtitle={
        open
          ? undefined
          : 'Откроется после решения. Можно открыть раньше — решение будет отмечено «с разбором».'
      }
    >
      {open ? (
        <div className="space-y-3 text-sm leading-relaxed">
          <div>
            <div className="mb-0.5 text-xs font-semibold tracking-wide text-subtle uppercase">
              Причина
            </div>
            <p className="text-fg">{def.debrief.cause}</p>
          </div>
          <div>
            <div className="mb-0.5 text-xs font-semibold tracking-wide text-subtle uppercase">
              Исправление
            </div>
            <p className="text-fg">{def.debrief.fix}</p>
          </div>
          <div>
            <div className="mb-0.5 text-xs font-semibold tracking-wide text-subtle uppercase">
              Что вынести
            </div>
            <p className="text-fg">{def.debrief.lesson}</p>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (
              window.confirm(
                'Разбор раскрывает причину и исправление. Решение после этого будет отмечено «с разбором». Открыть?',
              )
            )
              dispatch({ type: 'incident/debrief', id: def.id })
          }}
        >
          <BookOpenCheck size={13} /> Открыть разбор
        </Button>
      )}
    </Card>
  )
}
