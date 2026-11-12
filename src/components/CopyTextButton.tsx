import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from './ui'

export function CopyTextButton({
  text,
  label = 'Копировать',
  primary = false,
}: {
  text: string
  label?: string
  primary?: boolean
}) {
  const [last, setLast] = useState<{ status: 'idle' | 'copied' | 'error'; text: string }>({
    status: 'idle',
    text: '',
  })
  const status = last.text === text ? last.status : 'idle'
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timeout.current), [])
  const copy = async () => {
    clearTimeout(timeout.current)
    try {
      await navigator.clipboard.writeText(text)
      setLast({ status: 'copied', text })
      timeout.current = setTimeout(() => setLast({ status: 'idle', text: '' }), 2000)
    } catch {
      setLast({ status: 'error', text })
    }
  }
  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-1">
      <Button
        variant={primary ? 'primary' : 'secondary'}
        size={primary ? 'lg' : 'sm'}
        disabled={!text}
        onClick={copy}
        className="whitespace-normal!"
      >
        {status === 'copied' ? <Check size={14} /> : <Copy size={14} />}
        <span aria-live="polite">{status === 'copied' ? 'Скопировано' : label}</span>
      </Button>
      {status === 'error' && (
        <span role="alert" className="text-xs text-bad">
          Браузер не разрешил копирование. Выделите текст карточки и скопируйте вручную.
        </span>
      )}
    </span>
  )
}
