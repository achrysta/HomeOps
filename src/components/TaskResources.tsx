import { ChevronRight } from 'lucide-react'
import { useStore } from '../state/context'
import type { Resource } from '../types'
import { ResourceItem } from './ResourceItem'

const isRussian = (r: Resource) => r.language === 'ru' || !!r.ru

/** Материалы задачи: сначала на русском, англоязычная документация — свёрнутым справочником. */
export function TaskResources({ resourceIds }: { resourceIds: string[] }) {
  const { idx } = useStore()
  const all = resourceIds.map((id) => idx.resourceById.get(id)).filter((r): r is Resource => !!r)
  const ru = all.filter(isRussian)
  const en = all.filter((r) => !isRussian(r))

  if (all.length === 0) return <div className="text-xs text-subtle">Нет материалов</div>

  return (
    <div>
      {ru.length > 0 && (
        <div className="-mx-2">
          {ru.map((r) => (
            <ResourceItem key={r.id} resource={r} />
          ))}
        </div>
      )}
      {en.length > 0 && (
        <details className="group mt-2 rounded-lg border border-line" open={ru.length === 0}>
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs text-muted select-none hover:text-fg">
            <ChevronRight size={13} className="transition-transform group-open:rotate-90" />
            Справка на английском · {en.length}{' '}
            <span className="text-subtle">— официальная документация, если нужно уточнить детали</span>
          </summary>
          <div className="border-t border-line px-1 py-1">
            {en.map((r) => (
              <ResourceItem key={r.id} resource={r} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
