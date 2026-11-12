import {
  AlertTriangle,
  ArchiveRestore,
  Camera,
  CheckCircle2,
  Download,
  Eye,
  FileJson,
  RefreshCw,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { ApiResourceMessage } from '../components/ApiResourceMessage'
import { DataIssuesCard } from '../components/DataIssuesCard'
import { SyncIndicator } from '../components/SyncIndicator'
import { Button, Card, InfoTip, PageHeader } from '../components/ui'
import {
  buildExport,
  createEmptyProgress,
  downloadJSON,
  parseImport,
  STORAGE_KEY,
  todayLocal,
} from '../lib/storage'
import { compareStats, progressStats } from '../lib/snapshots'
import { createSnapshot } from '../lib/sync'
import { withDeadline } from '../lib/apiResource'
import { readBackups, readBackupText } from '../lib/dataReads'
import { useApiResource } from '../lib/useApiResource'
import type { UserProgress } from '../types'
import { useStore } from '../state/context'
import { useSyncStatus } from '../state/useSyncStatus'

type Message = { tone: 'ok' | 'bad'; text: string; details?: string[] }
type Preview = { name: string; savedAt?: string; progress: UserProgress; warnings: string[] }

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })

export function DataPage() {
  const { curriculum, progress, dispatch } = useStore()
  const sync = useSyncStatus()
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const {
    data: backups,
    loading: backupsLoading,
    error: backupsError,
    reload: loadBackups,
  } = useApiResource(readBackups, sync.revision)
  const [preview, setPreview] = useState<Preview | null>(null)

  const taskCount = Object.keys(progress.tasks).length
  const evidenceCount = Object.values(progress.tasks).reduce((a, t) => a + t.evidence.length, 0)
  const size = new Blob([JSON.stringify(progress)]).size
  const fileAvailable = sync.mode === 'synced' || sync.mode === 'saving'

  const doExport = () => {
    downloadJSON(`homeops-progress-${todayLocal()}.json`, buildExport(progress, curriculum))
    setMessage({ tone: 'ok', text: 'Копия сохранена в папку загрузок браузера.' })
  }

  const doSnapshot = async () => {
    const name = await createSnapshot('manual')
    setMessage(
      name
        ? { tone: 'ok', text: `Снимок создан: ${name}` }
        : { tone: 'bad', text: 'Не удалось создать снимок: файл прогресса недоступен.' },
    )
    loadBackups()
  }

  /**
   * Копия того, что сейчас в интерфейсе (включая ещё не записанные в файл правки), перед импортом или сбросом.
   * Сначала снимок на сервере; если сервер недоступен — файл в загрузки браузера, но только с согласия.
   * Возвращает описание, где лежит копия, или null — тогда заменять данные нельзя.
   */
  const backupCurrent = async (reason: string): Promise<string | null> => {
    const name = await createSnapshot(reason, progress)
    if (name) return `Предыдущее состояние сохранено в снимке ${name}.`
    if (
      !window.confirm(
        'Сервер хранения недоступен — снимок не создан.\n\nСкачать копию текущего прогресса в загрузки браузера и продолжить?',
      )
    )
      return null
    const filename = `homeops-progress-${reason}-${todayLocal()}.json`
    downloadJSON(filename, buildExport(progress, curriculum))
    return `Предыдущее состояние скачано в файл ${filename}.`
  }

  const doImport = async (file: File) => {
    const res = parseImport(await file.text(), curriculum)
    if (!res.ok) {
      setMessage({ tone: 'bad', text: `Импорт не выполнен: ${res.error}` })
      return
    }
    const tasks = Object.keys(res.progress.tasks).length
    const confirmText = `Заменить текущий прогресс данными из «${file.name}»?\n\nВ файле: ${tasks} задач с прогрессом.\nПеред заменой будет создан снимок текущего состояния.`
    if (!window.confirm(confirmText)) return
    const backup = await backupCurrent('before-import')
    if (!backup) {
      setMessage({ tone: 'bad', text: 'Импорт отменён: копия текущего состояния не сохранена.' })
      return
    }
    dispatch({ type: 'replace', progress: res.progress, touch: true })
    setMessage({
      tone: 'ok',
      text: `Импортировано: ${tasks} задач.`,
      details: [...res.warnings, backup],
    })
  }

  const openPreview = async (name: string) => {
    let text: string
    try {
      text = await withDeadline((signal) => readBackupText(name, signal))
    } catch {
      setMessage({
        tone: 'bad',
        text: `Не удалось прочитать снимок ${name}. Проверьте доступность дашборда и повторите попытку.`,
      })
      return
    }
    const res = parseImport(text, curriculum)
    if (!res.ok)
      return setMessage({ tone: 'bad', text: `Снимок ${name} не читается: ${res.error}` })
    let savedAt: string | undefined
    try {
      const raw = JSON.parse(text) as { savedAt?: unknown }
      if (typeof raw.savedAt === 'string') savedAt = raw.savedAt
    } catch {
      // parseImport уже проверил JSON
    }
    setPreview({ name, savedAt, progress: res.progress, warnings: res.warnings })
  }

  const doRestore = async (p: Preview) => {
    if (
      !window.confirm(
        `Заменить текущий прогресс снимком «${p.name}»?\n\nПеред заменой текущее состояние будет сохранено отдельным снимком.`,
      )
    )
      return
    const backup = await backupCurrent('before-restore')
    if (!backup) {
      setMessage({
        tone: 'bad',
        text: 'Восстановление отменено: копия текущего состояния не сохранена.',
      })
      return
    }
    dispatch({ type: 'replace', progress: p.progress, touch: true })
    setPreview(null)
    setMessage({
      tone: 'ok',
      text: `Прогресс восстановлен из снимка ${p.name}.`,
      details: [...p.warnings, backup],
    })
    loadBackups()
  }

  const doReset = async () => {
    if (!window.confirm('Сбросить весь прогресс, подтверждения и заметки?')) return
    if (window.prompt('Для подтверждения введите СБРОС') !== 'СБРОС') {
      setMessage({ tone: 'bad', text: 'Сброс отменён.' })
      return
    }
    const backup = await backupCurrent('before-reset')
    if (!backup) {
      setMessage({ tone: 'bad', text: 'Сброс отменён: копия текущего состояния не сохранена.' })
      return
    }
    dispatch({ type: 'replace', progress: createEmptyProgress(curriculum), touch: true })
    setMessage({
      tone: 'ok',
      text: 'Прогресс сброшен к начальному состоянию.',
      details: [`${backup} Его можно вернуть через импорт.`],
    })
  }

  return (
    <div>
      <PageHeader
        eyebrow="Прогресс"
        title="Резервная копия и данные"
        description="Скачайте копию прогресса или восстановите снимок."
      />

      {message && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${message.tone === 'ok' ? 'border-ok/30 bg-ok/10 text-ok' : 'border-bad/30 bg-bad/10 text-bad'}`}
        >
          <div className="flex items-center gap-2">
            {message.tone === 'ok' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            {message.text}
          </div>
          {message.details?.map((d) => (
            <div key={d} className="mt-1 pl-6 text-xs opacity-90">
              {d}
            </div>
          ))}
        </div>
      )}

      <Card
        className="mb-6"
        title="Хранилище и снимки"
        action={
          <InfoTip label="Как хранятся данные">
            Источник прогресса — файл в папке проекта; браузер хранит локальную копию. Изменения
            записываются автоматически. Снимки создаются раз в день и перед импортом или сбросом;
            сохраняются последние 60. Снимок можно посмотреть и восстановить значком глаза.
          </InfoTip>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-3 text-sm">
            <div className="text-xs">
              <SyncIndicator />
            </div>
            <dl>
              <Row
                label="Основное хранилище"
                value={
                  <code className="font-mono text-xs break-all">
                    {sync.file ?? 'data/progress.json'}
                  </code>
                }
              />
              <Row label="Ревизия файла" value={sync.revision || '—'} />
              <Row label="Последняя запись" value={sync.savedAt ? fmtDate(sync.savedAt) : '—'} />
              <Row
                label="Кэш браузера"
                value={<code className="font-mono text-xs">localStorage · {STORAGE_KEY}</code>}
              />
            </dl>
          </div>
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold tracking-wide text-subtle uppercase">
                Снимки {backups ? `· ${backups.backups.length}` : ''}
              </span>
              <span className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={loadBackups}
                  aria-label="Обновить список"
                >
                  <RefreshCw size={13} />
                </Button>
                <Button size="sm" onClick={() => void doSnapshot()} disabled={!fileAvailable}>
                  <Camera size={13} /> Сделать снимок
                </Button>
              </span>
            </div>
            <ApiResourceMessage
              loading={backupsLoading}
              error={backupsError}
              label="список снимков"
              onRetry={loadBackups}
            />
            {backups &&
              (backups.backups.length === 0 ? (
                <div className="text-sm text-muted">
                  Снимков пока нет. Создайте первый кнопкой «Сделать снимок».
                </div>
              ) : (
                <ul className="scrollbar-thin max-h-56 space-y-0.5 overflow-y-auto">
                  {backups.backups.map((b) => (
                    <li
                      key={b.name}
                      className={`flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-surface-2 ${preview?.name === b.name ? 'bg-surface-2' : ''}`}
                    >
                      <FileJson size={13} className="shrink-0 text-subtle" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-fg">{b.name}</span>
                        <span className="block text-subtle sm:hidden">
                          {fmtDate(b.modifiedAt)} · {(b.size / 1024).toFixed(1)} KB
                        </span>
                      </span>
                      <span className="hidden shrink-0 text-subtle sm:inline">
                        {fmtDate(b.modifiedAt)} · {(b.size / 1024).toFixed(1)} KB
                      </span>
                      <button
                        type="button"
                        onClick={() => void openPreview(b.name)}
                        className="shrink-0 text-subtle hover:text-accent"
                        title="Посмотреть и восстановить"
                        aria-label={`Посмотреть снимок ${b.name}`}
                      >
                        <Eye size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
            {backups && <p className="mt-2 text-xs break-all text-subtle">Папка: {backups.dir}</p>}
          </div>
        </div>
      </Card>

      {preview && (
        <SnapshotPreview
          preview={preview}
          current={progress}
          onRestore={() => void doRestore(preview)}
          onClose={() => setPreview(null)}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Экспорт в JSON" subtitle="Весь прогресс в одном файле">
          <Button variant="primary" size="lg" onClick={doExport}>
            <Download size={14} /> Экспортировать
          </Button>
        </Card>
        <Card title="Импорт из JSON" subtitle="Восстановление из экспорта или снимка">
          <p className="mb-4 text-sm text-muted">
            Заменит текущий прогресс. Сначала сохраним его копию.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void doImport(f)
              e.target.value = ''
            }}
          />
          <Button onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Выбрать файл…
          </Button>
        </Card>
        <Card title="Сброс" subtitle="Начать с чистого листа">
          <p className="mb-4 text-sm text-muted">
            Удалит весь прогресс после подтверждения и сохранения копии.
          </p>
          <Button variant="danger" onClick={() => void doReset()}>
            <RotateCcw size={14} /> Сбросить прогресс
          </Button>
        </Card>
      </div>

      <Card className="mt-6" title="Статистика">
        <dl className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
          <Row label="Размер данных" value={`${(size / 1024).toFixed(1)} KB`} />
          <Row label="Версия программы" value={curriculum.version} />
          <Row label="Задач с прогрессом" value={taskCount} />
          <Row label="Подтверждений" value={evidenceCount} />
          {progress.journal.length > 0 && <Row label="Записей старого дневника" value={progress.journal.length} />}
          <Row label="Изменено" value={fmtDate(progress.meta.updatedAt)} />
        </dl>
      </Card>

      <div className="mt-6">
        <DataIssuesCard />
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line/60 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-fg">{value}</dd>
    </div>
  )
}

function SnapshotPreview({
  preview,
  current,
  onRestore,
  onClose,
}: {
  preview: Preview
  current: UserProgress
  onRestore: () => void
  onClose: () => void
}) {
  const { curriculum } = useStore()
  const { rows, lost } = compareStats(
    progressStats(current, curriculum),
    progressStats(preview.progress, curriculum),
  )
  return (
    <Card
      className="mb-6"
      title={`Снимок ${preview.name}`}
      subtitle={`Сохранён ${fmtDate(preview.savedAt ?? preview.progress.meta.updatedAt)} · последнее изменение прогресса ${fmtDate(preview.progress.meta.updatedAt)}`}
      action={
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Закрыть предпросмотр">
          <X size={14} />
        </Button>
      }
    >
      <table className="mb-4 w-full max-w-xl text-sm">
        <thead>
          <tr className="text-left text-xs text-subtle">
            <th className="py-1 font-medium">Показатель</th>
            <th className="py-1 text-right font-medium">Сейчас</th>
            <th className="py-1 text-right font-medium">В снимке</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-line/60">
              <td className="py-1.5 text-muted">{r.label}</td>
              <td className="py-1.5 text-right font-mono tabular-nums text-fg">{r.current}</td>
              <td
                className={`py-1.5 text-right font-mono tabular-nums ${r.snapshot < r.current ? 'text-bad' : r.snapshot > r.current ? 'text-ok' : 'text-fg'}`}
              >
                {r.snapshot}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {lost.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            В снимке меньше, чем сейчас: {lost.map((r) => r.label.toLowerCase()).join(', ')}.
            Текущее состояние перед восстановлением сохранится отдельным снимком — его можно будет
            вернуть.
          </span>
        </div>
      )}
      {preview.warnings.map((w) => (
        <p key={w} className="mb-2 text-xs text-muted">
          {w}
        </p>
      ))}
      <Button variant="primary" onClick={onRestore}>
        <ArchiveRestore size={14} /> Восстановить этот снимок
      </Button>
    </Card>
  )
}
