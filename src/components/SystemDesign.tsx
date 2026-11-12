import { AlertTriangle, ArrowLeft, ArrowRight, Blocks, BookOpenCheck, CheckCircle2, Circle, Siren } from 'lucide-react'
import { DESIGN_MIN_CHARS } from '../config/weights'
import { canCheckDesign, designCoverage, designStatus, summarizeDesigns, type DesignStatus } from '../lib/design'
import { useStore } from '../state/context'
import { buildHash, navigate, useRoute } from '../state/router'
import { useLocalState } from '../state/useLocalState'
import type { DesignCase } from '../types'
import { Badge, Button, Card } from './ui'

const STATUS: Record<DesignStatus, { label: string; tone: 'neutral' | 'info' | 'ok' }> = {
  new: { label: 'Не начат', tone: 'neutral' },
  draft: { label: 'Черновик', tone: 'info' },
  checked: { label: 'Сверен с разбором', tone: 'ok' },
}

/**
 * Проектирование: свой ответ → отметка покрытых аспектов вслепую →
 * разбор-ориентир по аспектам и типичные ошибки → отметка после сверки.
 */
export function SystemDesign() {
  const { curriculum, progress } = useStore()
  const [ui, setUi] = useLocalState('interview.design', { caseId: '' })
  const { params } = useRoute()
  // ссылка из поиска открывает конкретный кейс поверх запомненного
  const linked = params.get('case')
  const selected = curriculum.designCases.find((c) => c.id === (linked ?? ui.caseId))
  const open = (caseId: string) => {
    setUi({ caseId })
    if (linked !== null) {
      const rest = new URLSearchParams(params)
      rest.delete('case')
      navigate('interview', Object.fromEntries(rest))
    }
  }
  if (selected) return <DesignCaseView key={selected.id} item={selected} onBack={() => open('')} />

  const summary = summarizeDesigns(curriculum.designCases, progress.interview.designs)
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        На кейс заложите 45–60 минут. Напишите свой дизайн, отметьте, какие аспекты он покрывает, и только потом откройте разбор. Сверено с разбором: {summary.checked} из {summary.total}
        {summary.drafts ? `, черновиков: ${summary.drafts}` : ''}. Это самопроверка: на обучение и навыки не влияет.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {curriculum.designCases.map((c) => {
          const answer = progress.interview.designs[c.id]
          const status = designStatus(answer)
          const cov = designCoverage(answer, curriculum.designAspects.length)
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => open(c.id)}
              className="group flex flex-col items-start rounded-xl bg-surface p-5 text-left shadow-card hover:ring-1 hover:ring-accent/40"
            >
              <div className="mb-2 flex w-full flex-wrap items-center gap-2">
                <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>
                {status !== 'new' && (
                  <span className="text-xs text-muted">
                    аспектов: {cov.before}
                    {cov.after !== null && cov.after !== cov.before ? ` → ${cov.after}` : ''} из {cov.total}
                  </span>
                )}
              </div>
              <span className="text-sm font-semibold text-fg group-hover:text-accent">{c.title}</span>
              <span className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted">{c.brief}</span>
              <span className="mt-3 inline-flex items-center gap-1 text-xs text-accent">
                {status === 'new' ? 'Решить кейс' : 'Открыть'} <ArrowRight size={12} />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DesignCaseView({ item, onBack }: { item: DesignCase; onBack: () => void }) {
  const { curriculum, progress, dispatch } = useStore()
  const answer = progress.interview.designs[item.id]
  const checked = !!answer?.checkedAt
  const cov = designCoverage(answer, curriculum.designAspects.length)
  const length = answer?.text.trim().length ?? 0
  const marks = checked ? (answer?.coveredAfter ?? answer?.covered ?? []) : (answer?.covered ?? [])

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent">
        <ArrowLeft size={13} /> Все кейсы
      </button>

      <Card title={item.title} subtitle="Условие">
        <p className="text-sm leading-relaxed text-fg">{item.brief}</p>
        <ul className="mt-3 space-y-1 text-sm text-muted">
          {item.givens.map((g) => (
            <li key={g}>· {g}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-subtle">Порядок: сначала требования и оценка нагрузки, потом схема компонентов, потом узкие места, отказы и стоимость.</p>
        {item.incidentIds.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            Похожие поломки в инцидентах:
            {item.incidentIds.map((id) => {
              const def = curriculum.incidents.find((d) => d.id === id)
              return def ? (
                <a key={id} href={buildHash('incidents', { id })} className="inline-flex items-center gap-1 text-accent hover:underline">
                  <Siren size={11} /> {def.title}
                </a>
              ) : null
            })}
          </div>
        )}
      </Card>

      <Card title="Ваш дизайн" subtitle="Требования, оценка нагрузки, компоненты и поток запроса (схема текстом), ключевые решения и компромиссы">
        <textarea
          className="field min-h-72 font-mono text-xs leading-relaxed"
          placeholder={'Требования: …\nОценка: 700 RPS × 500 токенов → …\nКомпоненты: клиент → gateway → …\nОтказы: …'}
          value={answer?.text ?? ''}
          onChange={(e) => dispatch({ type: 'design/text', caseId: item.id, text: e.target.value })}
        />
        <p className="mt-1 text-xs text-subtle">
          {length} симв.{!checked && length < DESIGN_MIN_CHARS ? ` — разбор откроется после ${DESIGN_MIN_CHARS} символов своего ответа` : ''}
        </p>
      </Card>

      <Card
        title="Аспекты ответа"
        subtitle={checked ? `Вслепую отмечено ${cov.before}, после сверки ${cov.after} из ${cov.total}` : 'Отметьте вслепую, какие аспекты ваш ответ уже покрывает'}
        action={
          !checked && (
            <Button size="sm" variant="primary" disabled={!canCheckDesign(answer)} onClick={() => dispatch({ type: 'design/check', caseId: item.id })}>
              <BookOpenCheck size={13} /> Сверить с разбором
            </Button>
          )
        }
      >
        <ul className="space-y-3">
          {curriculum.designAspects.map((aspect) => {
            const on = marks.includes(aspect.id)
            const blind = answer?.covered.includes(aspect.id) ?? false
            return (
              <li key={aspect.id} className="rounded-lg border border-line bg-surface-2/30 p-3">
                <label className="flex cursor-pointer flex-wrap items-start gap-x-2 gap-y-1">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={on}
                    onChange={(e) => dispatch({ type: 'design/aspect', caseId: item.id, aspectId: aspect.id, covered: e.target.checked })}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-fg">{aspect.title}</span>
                    <span className="block text-xs text-muted">{aspect.question}</span>
                  </span>
                  {checked && on !== blind && <span className={`w-full pl-6 text-[11px] sm:w-auto sm:pl-0 ${blind ? 'text-warn' : 'text-ok'}`}>{blind ? 'вслепую был отмечен' : 'добавлен после сверки'}</span>}
                </label>
                {checked && (
                  <ul className="mt-2 space-y-0.5 border-t border-line pt-2 pl-6 text-xs text-fg">
                    {(item.outline[aspect.id] ?? []).map((point) => (
                      <li key={point} className="flex gap-1.5">
                        {on ? <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-ok" /> : <Circle size={11} className="mt-0.5 shrink-0 text-subtle" />}
                        {point}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
        {checked && <p className="mt-3 text-xs text-muted">Если после разбора видно, что аспект в ответе не раскрыт, — снимите отметку. Отметки вслепую сохранены для сравнения.</p>}
      </Card>

      {checked && (
        <Card title="Типичные ошибки">
          <ul className="space-y-1.5 text-sm">
            {item.pitfalls.map((pitfall) => (
              <li key={pitfall} className="flex gap-1.5 text-warn">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {pitfall}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {checked && item.exerciseId && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/30 bg-accent/[0.06] p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Blocks size={18} />
          </span>
          <div className="min-w-0 flex-1 basis-56">
            <div className="text-sm font-medium text-fg">Закрепите схему</div>
            <div className="text-xs text-muted">Соберите её из блоков в тренажёре — среди них есть правдоподобные, но вредные решения.</div>
          </div>
          <Button variant="primary" onClick={() => navigate('trainer', { item: item.exerciseId! })}>
            Собрать архитектуру <ArrowRight size={13} />
          </Button>
        </div>
      )}
    </div>
  )
}
