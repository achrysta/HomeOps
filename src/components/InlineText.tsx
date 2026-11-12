import { CopyCommand } from './CopyCommand'

/** В шагах задачи inline code копируется; вопросы и разборы остаются обычным текстом. */
export function InlineText({ text, copyCode = false }: { text: string; copyCode?: boolean }) {
  return (
    <span className="min-w-0 [overflow-wrap:anywhere]">
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.startsWith('`') && part.endsWith('`') ? (
          copyCode ? <CopyCommand key={i} cmd={part.slice(1, -1)} inline /> : <code key={i} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] text-accent">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </span>
  )
}
