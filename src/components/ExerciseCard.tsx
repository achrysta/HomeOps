import { ArrowDown, ArrowUp, Check, ChevronDown, Trash2, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import { archZone, matchOptions, moveStep, type ExerciseAnswer } from '../lib/exercises'
import type { Exercise } from '../types'
import { InlineText } from './InlineText'

/**
 * Упражнение тренажёра: порядок, пары, ошибки или блоки архитектуры.
 * layout — перемешанные варианты сопоставления / блоки архитектуры (стабильны в пределах сессии).
 */
export function ExerciseCard({
  exercise,
  layout,
  answer,
  checked,
  onChange,
}: {
  exercise: Exercise
  layout: number[]
  answer: ExerciseAnswer
  checked: boolean
  onChange: (a: ExerciseAnswer) => void
}) {
  if (exercise.kind === 'order' && answer.kind === 'order') {
    return (
      <div>
        <div className="mb-2 text-xs text-muted">Расставьте шаги стрелками: сверху — первый.</div>
        <ol className="space-y-1.5">
          {answer.order.map((step, pos) => {
            const right = step === pos
            const style = checked ? (right ? 'border-ok/50 bg-ok/10' : 'border-bad/50 bg-bad/10') : 'border-line'
            return (
              <li key={step} className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-sm text-fg ${style}`}>
                <span className="w-5 shrink-0 text-center font-mono text-xs text-subtle">{pos + 1}</span>
                <span className="min-w-0 flex-1">
                  <InlineText text={exercise.steps[step]} />
                  {checked && !right && <span className="mt-0.5 block text-xs text-bad">на самом деле — шаг {step + 1}</span>}
                </span>
                {!checked && (
                  <span className="flex shrink-0 gap-0.5">
                    <button
                      type="button"
                      aria-label="Выше"
                      disabled={pos === 0}
                      onClick={() => onChange({ kind: 'order', order: moveStep(answer.order, pos, -1) })}
                      className="rounded p-2 text-subtle hover:bg-surface-2 hover:text-accent disabled:opacity-30"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label="Ниже"
                      disabled={pos === answer.order.length - 1}
                      onClick={() => onChange({ kind: 'order', order: moveStep(answer.order, pos, 1) })}
                      className="rounded p-2 text-subtle hover:bg-surface-2 hover:text-accent disabled:opacity-30"
                    >
                      <ArrowDown size={14} />
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    )
  }

  if (exercise.kind === 'match' && answer.kind === 'match') {
    const options = matchOptions(exercise)
    return (
      <div>
        <div className="mb-2 text-xs text-muted">Для каждого пункта выберите пару. Справа есть лишний вариант.</div>
        <div className="space-y-2">
          {exercise.pairs.map(([left], i) => {
            const pick = answer.picks[i]
            const right = pick === i
            return (
              <div key={left} className={`rounded-lg border px-3 py-2 ${checked ? (right ? 'border-ok/50 bg-ok/10' : 'border-bad/50 bg-bad/10') : 'border-line'}`}>
                <div className="mb-1.5 font-mono text-sm text-fg">{left}</div>
                {checked ? (
                  <div className="text-sm">
                    <span className={`flex items-start gap-1.5 ${right ? 'text-ok' : 'text-bad'}`}>
                      {right ? <Check size={14} className="mt-0.5 shrink-0" /> : <X size={14} className="mt-0.5 shrink-0" />}
                      <span>{pick >= 0 ? options[pick] : 'не выбрано'}</span>
                    </span>
                    {!right && <span className="mt-1 block text-xs text-muted">Верно: {options[i]}</span>}
                  </div>
                ) : (
                  <select
                    className="field w-full max-w-full text-sm"
                    value={pick}
                    onChange={(e) => onChange({ kind: 'match', picks: answer.picks.map((x, j) => (j === i ? Number(e.target.value) : x)) })}
                  >
                    <option value={-1}>— выберите —</option>
                    {layout.map((o) => (
                      <option key={o} value={o}>
                        {options[o]}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (exercise.kind === 'error' && answer.kind === 'error') {
    return (
      <div>
        <div className="mb-2 text-xs text-muted">Нажмите на строки с ошибкой. Их может быть несколько.</div>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface-2/40 py-1">
          {exercise.lines.map((line, i) => {
            const chosen = answer.lines.includes(i)
            const wrongLine = exercise.errors.includes(i)
            let style = chosen ? 'bg-accent/15 text-fg' : 'text-fg hover:bg-surface-2'
            if (checked) style = wrongLine ? (chosen ? 'bg-ok/15 text-fg' : 'bg-bad/15 text-fg') : chosen ? 'bg-bad/15 text-fg' : 'text-muted'
            return (
              <button
                key={i}
                type="button"
                disabled={checked}
                aria-pressed={chosen}
                onClick={() => onChange({ kind: 'error', lines: chosen ? answer.lines.filter((x) => x !== i) : [...answer.lines, i] })}
                className={`flex w-full min-w-max items-start gap-3 px-3 py-0.5 text-left font-mono text-xs leading-relaxed ${style}`}
              >
                <span className="w-5 shrink-0 text-right text-subtle select-none">{i + 1}</span>
                <span className="whitespace-pre">{line}</span>
                {checked && wrongLine && <span className={`ml-2 font-sans text-[11px] ${chosen ? 'text-ok' : 'text-bad'}`}>{chosen ? 'найдено' : 'ошибка здесь'}</span>}
              </button>
            )
          })}
        </div>
        {checked && (
          <div className="mt-3 rounded-lg border border-line px-3 py-2 text-sm text-fg">
            <span className="font-medium">Как правильно: </span>
            <InlineText text={exercise.fix} />
          </div>
        )}
      </div>
    )
  }

  if (exercise.kind === 'arch' && answer.kind === 'arch') {
    return <ArchBoard exercise={exercise} layout={layout} picks={answer.picks} checked={checked} onChange={(picks) => onChange({ kind: 'arch', picks })} />
  }

  return null
}

type ArchExercise = Extract<Exercise, { kind: 'arch' }>

/**
 * «Собери архитектуру»: блок выбирается касанием и ставится в слой схемы (или в «Не нужен»).
 * После проверки схема показывает правильное распределение, а разбор — почему каждый блок там, где он есть.
 * data-hotkeys="off": Enter на блоке нажимает блок, а не «Проверить» тренажёра.
 */
function ArchBoard({ exercise, layout, picks, checked, onChange }: { exercise: ArchExercise; layout: number[]; picks: number[]; checked: boolean; onChange: (picks: number[]) => void }) {
  const [sel, setSel] = useState<{ id: string; block: number } | null>(null)
  const selected = !checked && sel?.id === exercise.id ? sel.block : null
  const bin = exercise.zones.length
  const zoneTitle = (z: number) => (z === bin ? 'Не нужен' : exercise.zones[z])
  const order = layout.length === exercise.blocks.length ? layout : exercise.blocks.map((_, i) => i)
  const right = (i: number) => picks[i] === archZone(exercise, i)
  const set = (block: number, zone: number) => {
    onChange(picks.map((x, j) => (j === block ? zone : x)))
    setSel(null)
  }
  const place = (zone: number) => selected !== null && set(selected, zone)
  const pool = order.filter((i) => picks[i] < 0)
  const inZone = (z: number) => order.filter((i) => (checked ? archZone(exercise, i) : picks[i]) === z)

  const chip = (i: number) => {
    const title = exercise.blocks[i].title
    if (checked) {
      const ok = right(i)
      return (
        <span key={i} className={`inline-flex max-w-full items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-fg ${ok ? 'bg-ok/15' : 'bg-bad/15'}`}>
          {ok ? <Check size={14} className="mt-0.5 shrink-0 text-ok" /> : <X size={14} className="mt-0.5 shrink-0 text-bad" />}
          <InlineText text={title} />
        </span>
      )
    }
    const on = selected === i
    return (
      <button
        key={i}
        type="button"
        aria-pressed={on}
        onClick={(e) => {
          e.stopPropagation()
          setSel(on ? null : { id: exercise.id, block: i })
        }}
        className={`max-w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-fg shadow-card transition ${on ? 'bg-accent/15 ring-2 ring-accent' : 'bg-surface hover:ring-1 hover:ring-accent/50'}`}
      >
        <InlineText text={title} />
      </button>
    )
  }

  const zoneBox = (z: number) => {
    const isBin = z === bin
    const blocks = inZone(z)
    const target = selected !== null && picks[selected] !== z
    return (
      <div
        onClick={() => target && place(z)}
        className={`rounded-xl p-3 transition ${isBin ? 'border border-dashed border-line' : 'bg-surface-2/60'} ${target ? 'cursor-pointer ring-1 ring-accent/40 hover:ring-accent' : ''}`}
      >
        <div className="mb-2 flex items-center gap-2">
          {isBin ? (
            <Trash2 size={15} className="shrink-0 text-subtle" />
          ) : (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/10 text-xs font-semibold text-accent">{z + 1}</span>
          )}
          <span className={`min-w-0 flex-1 text-sm font-medium ${isBin ? 'text-muted' : 'text-fg'}`}>{zoneTitle(z)}</span>
        </div>
        <div className="flex min-h-8 flex-wrap gap-1.5">
          {blocks.length ? blocks.map(chip) : <span className="self-center text-xs text-subtle">{isBin ? 'Лишние блоки' : 'Пока пусто'}</span>}
        </div>
      </div>
    )
  }

  const wrong = order.filter((i) => !right(i))
  return (
    <div data-hotkeys="off" className="space-y-3">
      {!checked && (
        <>
          <p className="text-xs text-muted">
            {selected === null ? (
              'Нажмите на блок, затем на слой схемы. Лишние блоки — в «Не нужен». Поставленный блок можно выбрать снова и переставить.'
            ) : (
              'Выберите слой на панели внизу или нажмите на слой схемы.'
            )}
          </p>
          {pool.length > 0 && (
            <div className="rounded-xl bg-accent/[0.06] p-3">
              <div className="mb-2 text-xs font-medium text-muted">Блоки · осталось {pool.length}</div>
              <div className="flex flex-wrap gap-1.5">{pool.map(chip)}</div>
            </div>
          )}
        </>
      )}
      {checked && (
        <div className="text-sm font-medium text-fg">
          Правильная схема <span className="font-normal text-muted">· верно {order.length - wrong.length} из {order.length}</span>
        </div>
      )}
      <ol className="space-y-1">
        {exercise.zones.map((_, z) => (
          <li key={z}>
            {zoneBox(z)}
            {z < bin - 1 && <ChevronDown size={16} className="mx-auto my-0.5 text-subtle" aria-hidden />}
          </li>
        ))}
      </ol>
      {zoneBox(bin)}
      {selected !== null && (
        // Панель выбора слоя держится у нижнего края экрана: на телефоне блоки и слои не помещаются на один экран
        <div className="sticky bottom-3 z-10 rounded-xl bg-surface p-2.5 shadow-card ring-1 ring-accent/40">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-muted">
              Куда поставить «{exercise.blocks[selected].title}»?
            </span>
            <button type="button" aria-label="Отменить выбор" onClick={() => setSel(null)} className="shrink-0 rounded p-1 text-subtle hover:bg-surface-2 hover:text-fg">
              <X size={14} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[...exercise.zones.keys(), bin].map((z) => (
              <button
                key={z}
                type="button"
                disabled={picks[selected] === z}
                onClick={() => set(selected, z)}
                className="rounded-md bg-accent/10 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40"
              >
                {z === bin ? 'Не нужен' : `${z + 1} · ${exercise.zones[z]}`}
              </button>
            ))}
            {picks[selected] >= 0 && (
              <button type="button" onClick={() => set(selected, -1)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg">
                <Undo2 size={12} /> Вернуть в блоки
              </button>
            )}
          </div>
        </div>
      )}
      {checked && (
        <div className="space-y-2 pt-1">
          <div className="text-sm font-medium text-fg">Разбор блоков{wrong.length > 0 ? ' — сначала ошибки' : ''}</div>
          {[...wrong, ...order.filter(right)].map((i) => {
            const b = exercise.blocks[i]
            const ok = right(i)
            return (
              <div key={i} className={`rounded-xl p-3 ${ok ? 'bg-surface-2/60' : 'bg-bad/10'}`}>
                <div className="flex items-start gap-1.5 text-sm font-medium text-fg">
                  {ok ? <Check size={14} className="mt-0.5 shrink-0 text-ok" /> : <X size={14} className="mt-0.5 shrink-0 text-bad" />}
                  <InlineText text={b.title} />
                </div>
                <div className="mt-0.5 pl-5 text-xs text-muted">
                  {b.zone === null ? 'Лишний блок' : `Слой: ${zoneTitle(b.zone)}`}
                  {!ok && <span className="text-bad"> · у вас: {picks[i] >= 0 ? zoneTitle(picks[i]) : 'не выбрано'}</span>}
                </div>
                <div className="mt-1 pl-5 text-xs leading-relaxed text-fg">
                  <InlineText text={b.note} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
