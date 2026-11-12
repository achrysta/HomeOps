import { ChevronRight, Info } from 'lucide-react'
import { ImportanceBadge } from '../components/badges'
import { MatchOriginBar } from '../components/MatchOriginBar'
import { Badge, Card, InfoTip, PageHeader, ProgressBar, Ring } from '../components/ui'
import { IMPORTANCE_SHARE } from '../config/weights'
import {
  IMPORTANCE_LABEL,
  IMPORTANCE_TONE,
  LEVEL_LABEL,
  pct,
  targetName,
  toneForPct,
} from '../lib/labels'
import { IMPORTANCE_ORDER, matchOrigin, type RequirementRow } from '../lib/progress'
import { useStore } from '../state/context'
import { setSkillParam, setTaskParam } from '../state/router'
import type { Importance, Level } from '../types'

const LEVELS: Level[] = [0, 1, 2, 3, 4]

export function VacancyPage() {
  const { curriculum, progress, dispatch, vacancy, match } = useStore()

  return (
    <div>
      <PageHeader
        eyebrow="Прогресс"
        title="Навыки"
        description="Уровни навыков по профилю роли — отдельно от прогресса обучения. Текущий уровень — максимум из подтверждённого задачами и решёнными стендами и заявленного с обоснованием."
        actions={
          curriculum.vacancies.length > 1 && (
            <select
              className="field w-auto"
              value={progress.activeVacancyId}
              onChange={(e) => dispatch({ type: 'vacancy/active', id: e.target.value })}
            >
              {curriculum.vacancies.map((v) => (
                <option key={v.id} value={v.id}>
                  {targetName(v)}
                </option>
              ))}
            </select>
          )
        }
      />

      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Профиль роли" subtitle={targetName(vacancy)}>
          <p className="text-sm leading-relaxed text-fg">{vacancy.summary}</p>
          {vacancy.sources && vacancy.sources.length > 0 && (
            <p className="mt-2 text-xs text-subtle">
              Профиль собран по вакансиям: {vacancy.sources.join('; ')}.
            </p>
          )}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted">
                Платформа уже в production
              </div>
              <div className="flex flex-wrap gap-1.5">
                {vacancy.platform.map((p) => (
                  <Badge key={p} tone="accent">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted">Основные задачи</div>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">
                {vacancy.responsibilities.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
        </Card>

        <Card
          title="Покрытие профиля"
          action={
            <InfoTip label="Как считается покрытие">
              Покрытие навыка = min(текущий, целевой) / целевой. Категории усредняются и
              взвешиваются по долям ниже. Желательные навыки не добавят больше{' '}
              {Math.round(IMPORTANCE_SHARE.bonus * 100)}%, продвинутые не влияют.
            </InfoTip>
          }
        >
          <div className="mb-5 flex items-center gap-4">
            <Ring
              value={match.overall}
              size={84}
              tone={toneForPct(match.overall)}
              label={`Покрытие профиля ${pct(match.overall)}`}
            >
              <span className="text-lg font-semibold tabular-nums">{pct(match.overall)}</span>
            </Ring>
            <p className="min-w-0 text-xs leading-relaxed text-muted">
              Насколько подтверждённые уровни закрывают требования профиля. Строки ниже показывают,
              что подтянуть.
            </p>
          </div>
          <div className="mb-5">
            <div className="mb-1.5 text-xs font-medium text-muted">Откуда берётся оценка</div>
            <MatchOriginBar origin={matchOrigin(match)} />
          </div>
          <div className="space-y-3">
            {IMPORTANCE_ORDER.map((imp) => {
              const c = match.categories[imp]
              if (c.count === 0) return null
              return (
                <div key={imp}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2">
                      <ImportanceBadge importance={imp} />
                      <span className="text-muted">
                        вес {Math.round(IMPORTANCE_SHARE[imp] * 100)}% · {c.met}/{c.count}
                      </span>
                    </span>
                    <span className="font-semibold text-fg tabular-nums">
                      {imp === 'advanced' ? '—' : pct(c.pct)}
                    </span>
                  </div>
                  <ProgressBar value={c.pct} tone={IMPORTANCE_TONE[imp]} size="sm" />
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-xl bg-surface px-4 py-3 text-xs text-muted shadow-card">
        <Info size={14} className="mt-0.5 shrink-0 text-info" />
        <span>
          Уровни: {LEVELS.map((l) => `${l} — ${LEVEL_LABEL[l]}`).join(' · ')}. Строка открывает
          карточку навыка: что его подтверждает, следующий шаг и самооценка — она учитывается только
          с текстовым обоснованием.
        </span>
      </div>

      {(['required', 'important', 'bonus', 'advanced'] as Importance[]).map((imp) => {
        const rows = match.rows.filter((r) => r.req.importance === imp)
        if (!rows.length) return null
        return (
          <Card
            key={imp}
            className="mb-6"
            title={
              <span className="flex items-center gap-2">
                <ImportanceBadge importance={imp} /> {IMPORTANCE_LABEL[imp]} · {rows.length}
              </span>
            }
            subtitle={
              imp === 'advanced'
                ? 'Следующий уровень (GPU/Compute-инфраструктура). На покрытие профиля не влияет.'
                : undefined
            }
          >
            <div className="-mx-5 -mb-5 overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-line/70 text-left text-xs tracking-wider text-subtle uppercase">
                    <th className="w-8 px-5 py-2.5" />
                    <th className="px-2 py-2 font-medium">Навык</th>
                    <th className="px-2 py-2 font-medium">Текущий</th>
                    <th className="px-2 py-2 font-medium">Целевой</th>
                    <th className="px-2 py-2 font-medium">Важность</th>
                    <th className="px-2 py-2 font-medium">Подтверждение</th>
                    <th className="px-5 py-2.5 text-right font-medium">Разрыв</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <MatrixRow
                      key={row.skill.id}
                      row={row}
                      onOpen={() => setSkillParam(row.skill.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      })}

    </div>
  )
}

function MatrixRow({ row, onOpen }: { row: RequirementRow; onOpen: () => void }) {
  const { info } = row
  return (
    <tr
      className="cursor-pointer border-b border-line/60 align-top last:border-0 hover:bg-surface-2/50"
      onClick={onOpen}
      title="Открыть карточку навыка"
    >
      <td className="px-5 py-3.5 text-subtle">
        <ChevronRight size={14} />
      </td>
      <td className="px-2 py-3.5">
        <div className="font-medium text-fg">{row.skill.title}</div>
        {row.req.summary !== row.skill.title && (
          <div className="mt-0.5 text-xs text-muted">{row.req.summary}</div>
        )}
      </td>
      <td className="px-2 py-3.5 whitespace-nowrap">
        <div className="font-semibold text-fg tabular-nums">{row.current}</div>
        <div className="text-[11px] text-subtle">{LEVEL_LABEL[row.current]}</div>
      </td>
      <td className="px-2 py-3.5 font-semibold text-muted tabular-nums">{row.target}</td>
      <td className="px-2 py-3.5">
        <ImportanceBadge importance={row.req.importance} />
      </td>
      <td className="max-w-xs px-2 py-3.5 text-xs">
        {info.verifiedTaskIds.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1">
            {info.verifiedTaskIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setTaskParam(id)
                }}
              >
                <Badge tone="ok" className="font-mono hover:opacity-80">
                  {id}
                </Badge>
              </button>
            ))}
          </div>
        )}
        {info.claimNote && info.claimed > 0 && (
          <div className={info.claimCounts ? 'text-muted' : 'text-subtle line-through'}>
            {info.claimSource === 'self' ? 'Самооценка' : 'Стартовый уровень'} ({info.claimed}):{' '}
            {info.claimNote}
          </div>
        )}
        {info.claimSource === 'self' && !info.claimCounts && (
          <div className="text-warn">
            Самооценка {info.claimed} без обоснования — не учитывается
          </div>
        )}
        {info.verifiedTaskIds.length === 0 && !info.claimNote && (
          <span className="text-subtle">нет подтверждений</span>
        )}
      </td>
      <td className="px-5 py-3.5 text-right">
        {row.gap === 0 ? (
          <Badge tone="ok">✓</Badge>
        ) : (
          <span
            className={`font-mono font-semibold ${row.req.importance === 'required' ? 'text-bad' : 'text-warn'}`}
          >
            −{row.gap}
          </span>
        )}
      </td>
    </tr>
  )
}
