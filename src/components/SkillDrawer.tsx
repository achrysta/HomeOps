import { ArrowRight, CheckCircle2, Circle, Siren, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { INCIDENT_STATUS_LABEL, INCIDENT_STATUS_TONE, LEVEL_LABEL, pct, toneForPct } from '../lib/labels'
import { buildSkillCard, type SkillCardData, type SkillNextStep } from '../lib/skillCard'
import { useStore } from '../state/context'
import { buildHash, setSkillParam, setTaskParam } from '../state/router'
import type { Level } from '../types'
import { ImportanceBadge, KindBadge } from './badges'
import { StatusIcon } from './TaskRow'
import { Badge, Button, Drawer, ProgressBar } from './ui'

const LEVELS: Level[] = [1, 2, 3, 4]

/** Чем подтверждается уровень — по правилам программы (см. AGENTS.md, «Уровни навыков»). */
const HOW_TO_CONFIRM: Record<Level, string> = {
  0: '',
  1: 'чтение или контрольный тест',
  2: 'упражнение, лабораторная или стенд без разбора',
  3: 'интеграция — проект, близкий к production',
  4: 'только реальный опыт: самооценка с обоснованием',
}

/** Карточка навыка поверх любой страницы: ?skill=<id>. */
export function SkillDrawer({ skillId }: { skillId: string | null }) {
  const { curriculum, idx, progress, vacancy, levels, interview } = useStore()
  const card = skillId ? buildSkillCard(skillId, curriculum, idx, progress, vacancy, levels, interview) : null
  return (
    <Drawer open={!!card} onClose={() => setSkillParam(null)} title={card ? <SkillTitle card={card} /> : null}>
      {card && <SkillBody key={card.skill.id} card={card} />}
    </Drawer>
  )
}

function SkillTitle({ card }: { card: SkillCardData }) {
  const { info, requirement } = card
  return (
    <div>
      <div className="mb-1 text-xs text-muted">Навык роли</div>
      <h2 className="text-xl leading-snug font-bold tracking-tight text-fg sm:text-[22px]">{card.skill.title}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {requirement && <ImportanceBadge importance={requirement.importance} />}
        <Badge tone={requirement && info.current >= requirement.targetLevel ? 'ok' : 'neutral'}>
          уровень {info.current}
          {requirement ? ` из ${requirement.targetLevel}` : ''}
        </Badge>
        {info.earned < info.current && <Badge tone="info">практикой подтверждён {info.earned}</Badge>}
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="text-xs font-semibold tracking-wider text-subtle uppercase">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

function SkillBody({ card }: { card: SkillCardData }) {
  const { skill, info, requirement } = card
  const target = requirement?.targetLevel
  return (
    <div>
      <p className="mb-5 text-sm text-muted">{skill.description}</p>

      <NextStep next={card.next} reached={target !== undefined && info.current >= target} earnedBelow={info.earned < info.current} />

      <Section title="Уровень" hint="Уровень поднимают засчитанные задачи, решённые стенды и самооценка с обоснованием. Уровень 4 — только реальный production-опыт.">
        <ol className="space-y-1">
          {LEVELS.map((l) => {
            const earned = info.earned >= l
            const claimed = !earned && info.claimCounts && info.claimed >= l
            return (
              <li key={l} className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl px-3.5 py-2.5 text-sm ${earned ? 'border border-ok/35 bg-ok/[0.07]' : 'bg-surface shadow-card'}`}>
                <span className="w-4 font-semibold text-muted tabular-nums">{l}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-fg">{LEVEL_LABEL[l]}</span>
                  <span className="block text-xs text-muted">{HOW_TO_CONFIRM[l]}</span>
                </span>
                {earned && <Badge tone="ok">подтверждён практикой</Badge>}
                {claimed && <Badge tone="info">{info.claimSource === 'self' ? 'по самооценке' : 'по профилю'}</Badge>}
                {target === l && <Badge tone="accent">цель роли</Badge>}
              </li>
            )
          })}
        </ol>
      </Section>

      {card.outcomes.length > 0 && (
        <Section title="Результаты практики" hint="Первый критерий приёмки каждой задачи навыка; отмечено — задача засчитана.">
          <ul className="space-y-1 text-sm">
            {card.outcomes.map((o) => (
              <li key={o.taskId} className="flex gap-2">
                {o.done ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" /> : <Circle size={14} className="mt-0.5 shrink-0 text-subtle" />}
                <span className={o.done ? 'text-muted' : 'text-fg'}>{o.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Задачи и тесты" hint={card.tasks.length ? 'Засчитанная задача подтверждает уровень, указанный справа.' : 'В программе нет задач по этому навыку.'}>
        <div className="space-y-0.5">
          {card.tasks.map((r) => (
            <button key={r.task.id} type="button" onClick={() => setTaskParam(r.task.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-2">
              <StatusIcon task={r.task} />
              <span className="font-mono text-xs text-subtle">{r.task.id}</span>
              <span className="line-clamp-2 min-w-0 flex-1 text-fg sm:line-clamp-none sm:truncate">{r.task.title}</span>
              <span className="hidden sm:inline-flex">
                <KindBadge kind={r.task.kind} />
              </span>
              <span className="shrink-0 font-mono text-[11px] text-subtle">→ ур. {r.grants}</span>
            </button>
          ))}
        </div>
      </Section>

      {card.incidents.length > 0 && (
        <Section title="Стенды" hint="Решённый без разбора стенд подтверждает уровень 2, после открытого разбора — 1.">
          <ul className="space-y-1">
            {card.incidents.map(({ def, status, withDebrief }) => (
              <li key={def.id}>
                <a href={buildHash('incidents', { id: def.id })} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-2">
                  <Siren size={14} className={status === 'solved' ? 'text-ok' : 'text-subtle'} />
                  <span className="min-w-0 flex-1 truncate text-fg">{def.title}</span>
                  <Badge tone={INCIDENT_STATUS_TONE[status]}>{withDebrief ? 'Решён с разбором' : INCIDENT_STATUS_LABEL[status]}</Badge>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {card.topics.length > 0 && (
        <Section title="Своими словами" hint="Самопроверка ответом вслух: на уровень навыка не влияет.">
          <p className="mb-2 text-xs text-muted">
            Вопросов по навыку: {card.questions.total} · оценено: {card.questions.rated}
          </p>
          <ul className="space-y-1">
            {card.topics.map((t) => (
              <li key={t.topic.id}>
                <a href={buildHash('interview', { view: 'topics' })} className="flex items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate text-fg">{t.topic.title}</span>
                  <span className="text-xs text-muted">
                    {t.answered}/{t.topic.questions.length} оценено
                  </span>
                  <span className="w-20">
                    <ProgressBar value={t.pct} tone={toneForPct(t.pct)} size="sm" />
                  </span>
                  <span className="w-9 text-right text-xs font-semibold text-muted tabular-nums">{pct(t.pct)}</span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <SelfAssessment card={card} />
    </div>
  )
}

function NextStep({ next, reached, earnedBelow }: { next: SkillNextStep; reached: boolean; earnedBelow: boolean }) {
  const { idx } = useStore()
  const body = (() => {
    switch (next.kind) {
      case 'verify':
        return { title: next.task.title, text: `Отмечено «Выполнено», но не засчитано: отметьте критерии приёмки и добавьте подтверждение — это подтвердит уровень ${next.to}.`, taskId: next.task.id, action: 'Довести до зачёта' }
      case 'task':
        return { title: next.task.title, text: `Подтвердит уровень ${next.to}.`, taskId: next.task.id, action: 'Открыть задачу' }
      case 'prerequisite':
        return { title: next.task.title, text: `Сначала эта задача: она открывает «${next.unlocks.title}», которая подтвердит уровень ${next.to}.`, taskId: next.task.id, action: 'Открыть задачу' }
      case 'incident':
        return { title: next.def.title, text: `Стенд по этому навыку: решите его без разбора — это подтвердит уровень ${next.to}.`, href: buildHash('incidents', { id: next.def.id }), action: 'Открыть стенд' }
      case 'production':
        return { title: 'Все задачи по навыку засчитаны', text: 'Выше — только реальный опыт в production: отметьте его самооценкой с обоснованием ниже.' }
      case 'none':
        return { title: 'Практики по навыку в программе пока нет', text: 'Уровень берётся из профиля или самооценки с обоснованием.' }
    }
  })()
  const track = 'taskId' in body && body.taskId ? idx.trackById.get(idx.taskById.get(body.taskId)!.trackId) : undefined
  return (
    <section className="mb-6 rounded-2xl border border-accent/30 bg-accent/[0.06] p-5">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-accent">
        <Sparkles size={13} /> Следующий шаг{track ? ` · ${track.code} ${track.title}` : ''}
      </div>
      <div className="text-sm font-semibold text-fg">{body.title}</div>
      <p className="mt-1 text-xs text-muted">{body.text}</p>
      {reached && <p className="mt-1 text-xs text-ok">Цель роли достигнута{earnedBelow ? ' по профилю или самооценке — практика подтвердит её.' : '.'}</p>}
      {'href' in body && body.href && (
        <a href={body.href} className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent bg-accent px-2.5 py-1 text-xs font-semibold text-bg shadow-sm transition-colors hover:opacity-90">
          {body.action} <ArrowRight size={13} />
        </a>
      )}
      {'taskId' in body && body.taskId && (
        <Button size="sm" variant="primary" className="mt-3" onClick={() => setTaskParam(body.taskId!)}>
          {body.action} <ArrowRight size={13} />
        </Button>
      )}
    </section>
  )
}

function SelfAssessment({ card }: { card: SkillCardData }) {
  const { progress, dispatch } = useStore()
  const { skill, info } = card
  const sp = progress.skills[skill.id]
  const [level, setLevel] = useState<Level | null>(sp?.selfLevel ?? null)
  const [note, setNote] = useState(sp?.note ?? '')
  const saved = (sp?.selfLevel ?? null) === level && (sp?.note ?? '') === note
  return (
    <Section title="Самооценка" hint="Учитывается только с текстовым обоснованием: где и что делали, период, ссылка.">
      {skill.baselineLevel > 0 && (
        <div className="mb-2 text-xs text-muted">
          Стартовый уровень программы: {skill.baselineLevel} ({LEVEL_LABEL[skill.baselineLevel]}){skill.baselineEvidence ? ` — ${skill.baselineEvidence}` : ''}
        </div>
      )}
      <div className="mb-2 flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setLevel(null)}
          className={`rounded-lg px-2.5 py-1 text-xs ${level === null ? 'bg-accent/12 text-accent ring-1 ring-accent/40' : 'bg-surface-2 text-muted hover:text-fg'}`}
        >
          как в профиле
        </button>
        {([0, ...LEVELS] as Level[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLevel(l)}
            title={LEVEL_LABEL[l]}
            className={`rounded-lg px-3 py-1 text-xs font-semibold ${level === l ? 'bg-accent/12 text-accent ring-1 ring-accent/40' : 'bg-surface-2 text-muted hover:text-fg'}`}
          >
            {l}
          </button>
        ))}
      </div>
      <textarea
        className="field min-h-16 text-xs"
        placeholder="Обоснование: где и что делал (проект, период, ссылка). Без обоснования самооценка не учитывается."
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={saved} onClick={() => dispatch({ type: 'skill/self', id: skill.id, selfLevel: level, note })}>
          Сохранить
        </Button>
        {level !== null && level > info.earned && !note.trim() && <span className="text-xs text-warn">Нужен текст обоснования</span>}
        {saved && sp && <span className="text-xs text-subtle">сохранено</span>}
      </div>
    </Section>
  )
}
