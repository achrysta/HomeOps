import { Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, RefreshCw, X } from 'lucide-react'
import { lazy, Suspense, useId, useLayoutEffect, useRef, useState } from 'react'
import type { StandKind, TerminalNode } from '../lib/labs'
import { Badge, Button } from './ui'

const IncidentTerminal = lazy(() => import('./IncidentTerminal'))

interface TerminalTask {
  title: string
  scenario?: string
  goal: string
  constraints?: string[]
}

/** Разворачиваем тот же DOM и xterm: история, ввод и WebSocket остаются в одной сессии. */
export function TerminalWorkspace({ id, kind = 'compose', node, task, onClose }: { id: string; kind?: StandKind; node?: TerminalNode; task: TerminalTask; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [taskOpen, setTaskOpen] = useState(true)
  const [connection, setConnection] = useState<'connecting' | 'open' | 'closed'>('connecting')
  const [session, setSession] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<HTMLDivElement>(null)
  const expandRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const taskId = useId()
  const taskTitleId = useId()

  useLayoutEffect(() => {
    if (!expanded) return
    const root = rootRef.current
    if (!root) return
    const expandButton = expandRef.current
    const terminal = terminalRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Оверлей остаётся в своей ветке DOM, чтобы не пересоздать терминал. Остальные
    // ветки временно исключаются из фокуса и дерева доступности.
    const background: { element: HTMLElement; inert: boolean }[] = []
    let branch: HTMLElement = root
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          background.push({ element: sibling, inert: sibling.inert })
          sibling.inert = true
        }
      }
      branch = branch.parentElement
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof Node && terminal?.contains(event.target)) {
        // Tab и Esc нужны оболочке и редакторам. Для перехода к кнопкам есть отдельная клавиша.
        if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key === 'F6') {
          event.preventDefault()
          event.stopPropagation()
          expandButton?.focus()
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setExpanded(false)
      } else if (event.key === 'Tab') {
        const focusable = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, input, [tabindex="0"]')]
          .filter((el) => el.getClientRects().length > 0)
        const first = focusable[0]
        const last = focusable.at(-1)
        if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault()
          ;(event.shiftKey ? last : first)?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    terminal?.querySelector('textarea')?.focus({ preventScroll: true })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = previousOverflow
      background.forEach(({ element, inert }) => { element.inert = inert })
      expandButton?.focus()
    }
  }, [expanded])

  return (
    <div
      ref={rootRef}
      role={expanded ? 'dialog' : 'region'}
      aria-modal={expanded || undefined}
      aria-labelledby={titleId}
      className={expanded ? 'fixed inset-0 z-[60] flex flex-col bg-bg p-3 sm:p-5' : 'mt-4 min-w-0 rounded-xl border border-line bg-surface-2'}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 id={titleId} className="text-sm font-medium text-fg">{node ? `Терминал · узел ${node}` : 'Терминал'}</h3>
          <Badge tone={connection === 'open' ? 'ok' : connection === 'closed' ? 'warn' : 'neutral'}>
            {connection === 'open' ? 'Подключён' : connection === 'closed' ? 'Соединение закрыто' : 'Подключение…'}
          </Badge>
          {expanded && <span className="font-mono text-xs text-muted">{id}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {connection === 'closed' && (
            <Button size="sm" variant="ghost" onClick={() => { setConnection('connecting'); setSession((n) => n + 1) }}>
              <RefreshCw size={13} /> Переподключить
            </Button>
          )}
          {expanded && (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={taskOpen}
              aria-controls={taskId}
              onClick={() => setTaskOpen((value) => !value)}
            >
              {taskOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
              {taskOpen ? 'Скрыть задание' : 'Показать задание'}
            </Button>
          )}
          <Button ref={expandRef} size="sm" variant="ghost" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? 'Свернуть терминал' : 'Развернуть терминал на весь экран'}>
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />} {expanded ? 'Свернуть' : 'На весь экран'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Закрыть терминал">
            <X size={14} />
          </Button>
        </div>
      </div>
      <div className={expanded ? 'flex min-h-0 flex-1 flex-col gap-3 py-3 md:flex-row' : 'h-[420px] p-2'}>
        <aside
          id={taskId}
          aria-labelledby={taskTitleId}
          hidden={!expanded || !taskOpen}
          tabIndex={0}
          className="max-h-[30dvh] shrink-0 space-y-3 overflow-auto rounded-xl border border-line bg-surface p-4 text-sm leading-relaxed wrap-break-word md:max-h-none md:w-[min(32vw,24rem)]"
        >
          <h4 id={taskTitleId} className="font-semibold text-fg">{task.title}</h4>
          {task.scenario && (
            <div>
              <h5 className="font-medium text-warn">Сценарий</h5>
              <p>{task.scenario}</p>
            </div>
          )}
          <div>
            {task.scenario && <h5 className="font-medium text-accent">Цель</h5>}
            <p>{task.goal}</p>
          </div>
          {!!task.constraints?.length && (
            <div>
              <h5 className="font-medium text-bad">Ограничения</h5>
              <ul className="list-disc space-y-1 pl-5">
                {task.constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}
              </ul>
            </div>
          )}
        </aside>
        <div ref={terminalRef} className={expanded ? 'min-h-0 min-w-0 flex-1' : 'h-full'}>
          <Suspense fallback={<div className="text-sm text-muted">Загружаю терминал…</div>}>
            <IncidentTerminal key={`${session}-${node ?? ''}`} id={id} node={node} onState={setConnection} className="h-full" />
          </Suspense>
        </div>
      </div>
      <p className="shrink-0 px-3 pb-3 text-xs text-muted">
        {node
          ? 'Узел kind под root: systemctl status kubelet, journalctl -u kubelet, crictl ps -a и crictl logs; static pods — /etc/kubernetes/manifests, конфиг kubelet — /var/lib/kubelet/config.yaml.'
          : kind === 'server'
          ? 'Учебный сервер под root. Журналы — journalctl -u <сервис>. Проверка — команда verify или кнопка «Проверить».'
          : kind === 'cluster'
            ? 'kubectl в общем кластере, namespace стенда выбран. Начните с kubectl get pods и kubectl describe; k — алиас, Tab — автодополнение.'
            : 'Сервисы доступны по именам, файлы стенда — в /scenario. Docker-команды выполняются кнопками стенда или в вашем терминале.'}
        {expanded && <span className="ml-2 whitespace-nowrap">Ctrl+Shift+F6 — к кнопкам терминала.</span>}
      </p>
    </div>
  )
}
