// Терминал стенда в браузере: xterm.js ↔ WebSocket ↔ sh в контейнере shell внутри сети стенда.
// Загружается лениво (React.lazy), чтобы xterm не попадал в основной бандл.

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import { terminalUrl, type TerminalNode } from '../lib/labs'

export default function IncidentTerminal({ id, node, onState, className = 'h-[420px]' }: { id: string; node?: TerminalNode; onState?: (state: 'open' | 'closed') => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const onStateRef = useRef(onState)

  useEffect(() => {
    onStateRef.current = onState
  }, [onState])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: { background: '#0d1117', foreground: '#d1d9e0', cursor: '#7ee2b8', selectionBackground: '#264f78' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return true
      // В нелатинской раскладке используем физическую клавишу.
      const key = /^[a-z]$/i.test(event.key) ? `Key${event.key.toUpperCase()}` : event.code
      // Оставляем браузеру нативные copy/paste: xterm уже обрабатывает эти события.
      // Без выделения Ctrl+C по-прежнему передаётся в PTY как прерывание.
      return key !== 'KeyV' && (key !== 'KeyC' || !term.hasSelection())
    })
    fit.fit()

    const ws = new WebSocket(terminalUrl(id, node))
    ws.binaryType = 'arraybuffer'
    const sendSize = () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'r', c: term.cols, r: term.rows }))
    }
    ws.onopen = () => {
      sendSize()
      term.focus()
      onStateRef.current?.('open')
    }
    ws.onmessage = (e: MessageEvent<ArrayBuffer | string>) => term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data))
    ws.onclose = () => {
      term.write('\r\n\x1b[2m[соединение закрыто]\x1b[0m\r\n')
      onStateRef.current?.('closed')
    }
    const input = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'i', d }))
    })
    const resize = term.onResize(sendSize)
    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(el)

    return () => {
      observer.disconnect()
      input.dispose()
      resize.dispose()
      ws.onopen = null
      ws.onmessage = null
      ws.onclose = null
      ws.close()
      term.dispose()
    }
  }, [id, node])

  return (
    <div className={`${className} w-full overflow-hidden rounded-md border border-line bg-term p-2`}>
      {/* FitAddon измеряет родителя xterm. Отступы и рамка остаются снаружи. */}
      <div ref={ref} className="h-full w-full" />
    </div>
  )
}
