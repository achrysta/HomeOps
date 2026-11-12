import { CircleStop, FileText, Loader2, Play, RefreshCw, RotateCcw, ShieldCheck, SquareTerminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cliCommands, clusterState, fetchLabLogs, presetParts, requestReportsRefresh, runLabAction, STAND_STATE_LABEL, standKind, standServices, standState, type LabAction, type LabsStatus, type TerminalNode } from '../lib/labs'
import type { Tone } from '../lib/labels'
import { useStore } from '../state/context'
import { useLocalState } from '../state/useLocalState'
import type { IncidentDef } from '../types'
import { CopyCommand } from './CopyCommand'
import { StandMemory } from './StandMemory'
import { Badge, Button, Card, InfoTip, Segmented } from './ui'
import { TerminalWorkspace } from './TerminalWorkspace'

const STATE_TONE: Record<ReturnType<typeof standState>, Tone> = { stopped: 'neutral', running: 'ok', starting: 'info', degraded: 'warn' }
const ACTION_LABEL: Record<LabAction, string> = { up: 'Запуск стенда', verify: 'Автопроверка', reset: 'Сброс стенда', down: 'Остановка стенда' }

interface Props {
  def: IncidentDef
  /** undefined — ещё загружается, null — сервис стендов недоступен */
  labs: LabsStatus | null | undefined
  onChanged: () => void
}

/** Управление стендом инцидента: запуск, проверка, сброс, логи и терминал. */
export function IncidentStand({ def, labs, onChanged }: Props) {
  const { dispatch } = useStore()
  const [ui, setUi] = useLocalState(`incident.${def.id}`, { preset: '' })
  const [running, setRunning] = useState<LabAction | null>(null)
  const [output, setOutput] = useState<{ action: LabAction; text: string; code: number | null } | null>(null)
  const [terminal, setTerminal] = useState(false)
  // Стенд уровня кластера: терминал в рабочем месте или в узле kind
  const [node, setNode] = useState<TerminalNode | ''>('')
  const [logs, setLogs] = useState<{ service: string; text: string } | null>(null)
  const outputRef = useRef<HTMLPreElement>(null)
  const terminalButtonRef = useRef<HTMLButtonElement>(null)

  const info = labs?.incidents[def.id]
  const containers = info?.containers ?? []
  const presets = info?.presets ?? []
  const preset = presets.some((p) => p.id === ui.preset) ? ui.preset : presets.find((p) => p.id.includes('3b'))?.id ?? presets[0]?.id ?? ''
  const state = standState(containers)
  const services = standServices(containers)
  const available = !!labs?.ok
  const gpuBlocked = def.requires === 'nvidia-gpu' && labs?.gpu?.available !== true
  const kind = standKind(def)
  const nodes = labs?.cluster?.nodes ?? []

  useEffect(() => {
    const el = outputRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [output?.text])

  const act = async (action: LabAction) => {
    if (gpuBlocked && action !== 'down') return
    if (action === 'up' || action === 'verify') dispatch({ type: 'incident/start', id: def.id })
    setRunning(action)
    setOutput({ action, text: '', code: null })
    try {
      const code = await runLabAction(def.id, action, preset || undefined, (chunk) =>
        setOutput((o) => (o ? { ...o, text: (o.text + chunk).slice(-60_000) } : o)),
      )
      setOutput((o) => (o ? { ...o, code } : o))
      if (action === 'down' && code === 0) setTerminal(false)
    } catch {
      setOutput((o) => (o ? { ...o, code: -1, text: `${o.text}\nНе удалось получить результат действия. Обновите состояние стенда перед повтором.\n` } : o))
    } finally {
      setRunning(null)
      if (action === 'verify') requestReportsRefresh()
      onChanged()
    }
  }

  const loadLogs = async (service: string) => setLogs({ service, text: await fetchLabLogs(def.id, service) })

  if (labs === undefined) {
    return (
      <Card title="Стенд">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> Проверяю сервис стендов…
        </div>
      </Card>
    )
  }

  if (!available) {
    return (
      <Card title="Стенд" subtitle="Сервис стендов не отвечает — управлять стендом можно командами в терминале">
        {def.requires === 'nvidia-gpu' && <p className="mb-3 text-sm text-warn">Нужна NVIDIA GPU в Docker. На Mac CUDA недоступна — запустите этот стенд на Windows/WSL.</p>}
        <p className="mb-3 text-sm text-muted">
          {labs?.error ?? 'Кнопки, логи и терминал работают, когда дашборд запущен через docker compose up -d (в режиме npm run dev сервис стендов тоже должен быть запущен).'}
        </p>
        {def.nodeAccess && (
          <div className="mb-3 flex items-center gap-2 text-sm text-warn">
            Стенд работает один на свежем кластере
            <InfoTip label="Как запустить или сбросить стенд уровня кластера">
              Сначала остановите остальные Kubernetes-стенды и залы. Команды ниже удаляют общий кластер и готовят поломку в его узлах. Для сброса повторите последовательность от остановки рабочего места до его запуска. Для окончания работы остановите рабочее место и удалите кластер.
            </InfoTip>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {cliCommands(def.id, preset || undefined, kind, def.nodeAccess).map((c) => (
            <CopyCommand key={c.cmd} label={c.label} cmd={c.cmd} />
          ))}
        </div>
        <p className="mt-3 text-xs text-subtle">Результат автопроверки придёт сюда сам. Если стенд работает на другом компьютере, загрузите файл отчёта .reports/last.json в блоке «Проверка».</p>
      </Card>
    )
  }

  return (
    <Card
      title="Стенд"
      subtitle={
        def.server
          ? 'Учебный Linux-сервер: всё делается в терминале на сервере, «Сбросить» пересоздаёт его со свежей поломкой'
          : def.nodeAccess
            ? 'Стенд уровня кластера: ломает узлы, поэтому работает один на свежем кластере kind. Терминал — в рабочем месте с kubectl или прямо в узле; «Сбросить» и «Остановить» пересоздают или удаляют кластер'
          : def.cluster
            ? `Namespace в общем кластере kind: kubectl в терминале, манифесты — в incidents/${def.id}/manifests. «Сбросить» возвращает манифесты и заново готовит namespace`
            : def.onDemand
            ? 'Постоянных сервисов нет: pipeline запускается в терминале и при автопроверке'
            : `Папка incidents/${def.id} — конфиги правьте в своём редакторе, изменения сразу видны в контейнерах`
      }
      action={
        <Button size="sm" variant="ghost" onClick={onChanged} aria-label="Обновить состояние">
          <RefreshCw size={13} />
        </Button>
      }
    >
      {gpuBlocked && (
        <p role="status" className="mb-3 rounded-lg bg-warn/10 p-3 text-sm text-warn">
          {labs?.gpu?.reason || 'NVIDIA GPU в Docker не подтверждена. На Mac CUDA недоступна; используйте Windows/WSL.'}
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {!def.onDemand && <Badge tone={STATE_TONE[state]}>{STAND_STATE_LABEL[state]}</Badge>}
        {containers
          .filter((c) => !c.oneoff && !c.name.endsWith('-terminal'))
          .map((c) => (
            <span key={c.name} className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted" title={c.status}>
              <span className={`h-1.5 w-1.5 rounded-full ${c.state === 'running' ? (c.health === 'unhealthy' ? 'bg-warn' : 'bg-ok') : /Exited \(0\)/.test(c.status) ? 'bg-subtle' : 'bg-bad'}`} />
              {c.service}
            </span>
          ))}
        {def.cluster && (
          <span className="inline-flex flex-wrap items-center gap-1 text-[11px] text-muted" title="Узлы общего кластера kind">
            кластер:
            {nodes.length ? (
              nodes.map((n) => (
                <span key={n.name} className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 font-mono" title={n.status}>
                  <span className={`h-1.5 w-1.5 rounded-full ${n.state === 'running' ? 'bg-ok' : 'bg-bad'}`} />
                  {n.role || n.name}
                </span>
              ))
            ) : (
              <span className="text-subtle">не создан — создастся при запуске (1–3 мин)</span>
            )}
            {clusterState(nodes) === 'partial' && <span className="text-warn">часть узлов остановлена — запуск пересоздаст кластер</span>}
          </span>
        )}
      </div>

      {presets.length > 0 && (
        <div className="mb-3 min-w-0 text-sm">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label htmlFor={`preset-${def.id}`} className="text-muted">
              Модель
            </label>
            <select
              id={`preset-${def.id}`}
              value={preset}
              disabled={!!running}
              onChange={(e) => setUi({ preset: e.target.value })}
              className="field w-auto max-w-full min-w-0 py-1"
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {presetParts(p.label).name}
                </option>
              ))}
            </select>
          </div>
          {(() => {
            const selected = presets.find((p) => p.id === preset)
            const hint = selected ? presetParts(selected.label).details : ''
            return (
              <p className="mt-1 text-xs text-subtle">
                {hint && <span className="text-muted">{hint}. </span>}
                {state !== 'stopped' && 'Смена модели применится при следующем запуске или сбросе.'}
              </p>
            )
          })()}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!def.onDemand && (
          <Button variant={state === 'stopped' ? 'primary' : 'secondary'} disabled={!!running || gpuBlocked} onClick={() => void act('up')}>
            {running === 'up' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {state === 'stopped' ? 'Запустить' : 'Пересоздать'}
          </Button>
        )}
        <Button variant={state !== 'stopped' || def.onDemand ? 'primary' : 'secondary'} disabled={!!running || gpuBlocked || (!def.onDemand && state === 'stopped')} onClick={() => void act('verify')}>
          {running === 'verify' ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Проверить
        </Button>
        <Button
          ref={terminalButtonRef}
          disabled={gpuBlocked && !terminal}
          variant={terminal ? 'secondary' : 'ghost'}
          onClick={() => {
            setTerminal((t) => !t)
          }}
        >
          <SquareTerminal size={14} /> {terminal ? 'Закрыть терминал' : 'Терминал'}
        </Button>
        <Button
          variant="ghost"
          disabled={!!running || gpuBlocked}
          onClick={() => {
            const text = def.server
              ? 'Пересоздать сервер со свежей поломкой? Все изменения на сервере пропадут.'
              : def.cluster
                ? 'Вернуть манифесты и заново подготовить namespace стенда в кластере? Ваши правки в manifests и изменения в кластере пропадут.'
                : 'Вернуть файлы стенда в исходное (сломанное) состояние? Ваши правки в папке стенда пропадут.'
            if (window.confirm(text)) void act('reset')
          }}
        >
          <RotateCcw size={14} /> Сбросить
        </Button>
        {!def.onDemand && state !== 'stopped' && (
          <Button variant="ghost" disabled={!!running} onClick={() => void act('down')}>
            <CircleStop size={14} /> Остановить
          </Button>
        )}
      </div>

      {terminal && def.nodeAccess && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
          Где открыть терминал:
          <Segmented
            size="sm"
            value={node}
            onChange={setNode}
            options={[
              { value: '', label: 'рабочее место (kubectl)' },
              { value: 'control-plane', label: 'узел control-plane' },
              { value: 'worker', label: 'узел worker' },
            ]}
          />
        </div>
      )}
      {terminal && (
        <TerminalWorkspace id={def.id} kind={kind} node={node || undefined} task={def} onClose={() => { setTerminal(false); terminalButtonRef.current?.focus() }} />
      )}

      {output && (
        <div className="mt-4">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted">
            {ACTION_LABEL[output.action]}
            {output.code === null ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Badge tone={output.code === 0 ? 'ok' : output.action === 'verify' && output.code === 1 ? 'warn' : 'bad'}>
                {output.code === 0 ? 'готово' : output.action === 'verify' && output.code === 1 ? 'проверки не пройдены' : `ошибка (код ${output.code})`}
              </Badge>
            )}
          </div>
          <pre ref={outputRef} className="scrollbar-thin max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-fg">
            {output.text.trim() || '…'}
          </pre>
        </div>
      )}

      {services.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <FileText size={13} /> Логи:
          </span>
          {services.map((s) => (
            <Button key={s} size="sm" variant={logs?.service === s ? 'secondary' : 'ghost'} onClick={() => void loadLogs(s)}>
              {s}
            </Button>
          ))}
          {logs && (
            <Button size="sm" variant="ghost" onClick={() => void loadLogs(logs.service)} aria-label="Обновить логи">
              <RefreshCw size={12} />
            </Button>
          )}
        </div>
      )}
      {logs && (
        <pre className="scrollbar-thin mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-fg">
          {logs.text.trim() || 'Логов пока нет.'}
        </pre>
      )}
      {/* У Kubernetes-стенда контейнер — только рабочее место kubectl: память подов смотрят kubectl top */}
      {kind !== 'cluster' && !def.onDemand && services.length > 0 && <StandMemory id={def.id} />}
    </Card>
  )
}
