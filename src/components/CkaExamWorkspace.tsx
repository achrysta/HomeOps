import { useState } from 'react'
import { bounded } from '../lib/ckaExamActions'
import { fetchLabLogs, standServices, type LabsStatus } from '../lib/labs'
import type { IncidentDef } from '../types'
import { TerminalWorkspace } from './TerminalWorkspace'
import { Button } from './ui'

/** Тот же терминал и клиент логов, без подсказок, разбора и живых проверок. */
export function CkaExamWorkspace({ def, labs, locked }: { def: IncidentDef; labs: LabsStatus | null | undefined; locked: boolean }) {
  const { id } = def
  const [terminal, setTerminal] = useState(false)
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(false)
  const services = standServices(labs?.incidents[id]?.containers ?? [])
  const load = async (service: string) => {
    setLoading(true)
    try { setLogs(await bounded(fetchLabLogs(id, service), 15_000)) }
    catch (error) { setLogs(error instanceof Error ? error.message : 'Не удалось получить логи. Повторите загрузку.') }
    finally { setLoading(false) }
  }
  return <div className="mt-5 xl:has-[[aria-modal=true]]:z-[60]">
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" disabled={locked || !labs?.ok} onClick={() => setTerminal(true)}>Открыть терминал</Button>
      <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load('')}>{loading ? 'Загружаем логи…' : 'Все логи'}</Button>
      {services.map((service) => <Button key={service} variant="ghost" size="sm" disabled={loading} onClick={() => void load(service)}>Логи · {service}</Button>)}
    </div>
    {!labs?.ok && <p className="mt-2 text-xs text-warn">Сервис стендов недоступен. Проверьте контейнер labs; после восстановления можно снова открыть терминал.</p>}
    {terminal && !locked && <TerminalWorkspace id={id} kind="cluster" task={def} onClose={() => setTerminal(false)} />}
    {logs && <pre className="mt-3 max-h-72 overflow-y-auto rounded-lg bg-term p-3 font-mono text-xs whitespace-pre-wrap wrap-anywhere text-[#d1d9e0]">{logs}</pre>}
  </div>
}
