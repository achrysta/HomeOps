import { Bookmark, BookmarkCheck } from 'lucide-react'
import { isSaved } from '../lib/practice'
import { useStore } from '../state/context'
import type { SavedItem } from '../types'

/** Закладка «сохранить на потом» у задачи, инцидента или материала. */
export function SaveToggle({ kind, id, label = false }: { kind: SavedItem['kind']; id: string; label?: boolean }) {
  const { progress, dispatch } = useStore()
  const saved = isSaved(progress.saved, kind, id)
  const title = saved ? 'Убрать из сохранённых' : 'Сохранить на потом'
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={title}
      title={title}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        dispatch({ type: 'saved/toggle', kind, id })
      }}
      className={`inline-flex shrink-0 items-center gap-1 rounded p-1 text-xs ${saved ? 'text-warn' : 'text-subtle hover:text-fg'}`}
    >
      {saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
      {label && <span>{saved ? 'Сохранено' : 'Сохранить'}</span>}
    </button>
  )
}
