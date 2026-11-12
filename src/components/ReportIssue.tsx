import { Flag, X } from 'lucide-react'
import { useState } from 'react'
import { ISSUE_TYPE_LABEL, postIssue, type IssueKind, type IssueType } from '../lib/issues'
import { Button } from './ui'

const TYPES: IssueType[] = ['wrong', 'link', 'unclear', 'other']
const PLACEHOLDER: Record<IssueType, string> = {
  wrong: 'Что не так: какой вариант на самом деле верный и почему',
  link: 'Какая ссылка не открывается (необязательно)',
  unclear: 'Что непонятно в формулировке',
  other: 'Опишите проблему',
}

/**
 * «Есть проблема»: замечание к вопросу, задаче, инциденту или материалу. Записывается в data/content-issues.json,
 * агент разбирает его при следующей работе над программой. На прогресс не влияет.
 */
export function ReportIssue({ kind, targetId, targetTitle, className = '' }: { kind: IssueKind; targetId: string; targetTitle: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<IssueType>('wrong')
  const [text, setText] = useState('')
  const [state, setState] = useState<{ sending: boolean; done: boolean; error: string | null }>({ sending: false, done: false, error: null })

  const send = async () => {
    setState({ sending: true, done: false, error: null })
    const error = await postIssue({ kind, targetId, targetTitle, type, text })
    setState({ sending: false, done: !error, error })
    if (!error) setText('')
  }

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => {
          setOpen(!open)
          setState({ sending: false, done: false, error: null })
        }}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs text-subtle hover:text-warn"
        title="Сообщить о проблеме: неверный ответ, битая ссылка, непонятная формулировка"
      >
        <Flag size={12} /> Есть проблема
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Сообщить о проблеме"
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          className="fixed inset-x-4 top-24 z-50 rounded-xl bg-surface p-4 text-left shadow-lg ring-1 ring-line sm:absolute sm:inset-x-auto sm:top-6 sm:right-0 sm:z-30 sm:w-80"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-fg">Что не так?</span>
            <button type="button" onClick={() => setOpen(false)} className="text-subtle hover:text-fg" aria-label="Закрыть">
              <X size={14} />
            </button>
          </div>
          {state.done ? (
            <p className="text-sm leading-relaxed text-muted">Записано: список замечаний — на странице «Резервная копия». Чтобы исправление попало в программу, опишите проблему в issue репозитория.</p>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    aria-pressed={type === t}
                    className={`rounded-lg px-2 py-1 text-xs ${type === t ? 'bg-warn/12 text-warn ring-1 ring-warn/40' : 'bg-surface-2 text-muted hover:text-fg'}`}
                  >
                    {ISSUE_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
              <textarea className="field min-h-20 text-xs" placeholder={PLACEHOLDER[type]} value={text} onChange={(e) => setText(e.target.value)} aria-label="Описание проблемы" />
              {state.error && <p className="mt-2 text-xs text-bad">Не удалось отправить: {state.error}</p>}
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  Отмена
                </Button>
                <Button size="sm" variant="primary" disabled={state.sending || (type === 'other' && !text.trim())} onClick={() => void send()}>
                  Отправить
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </span>
  )
}
