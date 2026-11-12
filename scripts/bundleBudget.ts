import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'

export const MAIN_BUDGET_BYTES = 900_000
interface Chunk {
  type: 'chunk'; fileName: string; isEntry: boolean; code: string
  imports: string[]; modules: Record<string, unknown>
}

/** Контролируем не только размер entry, но и возврат планов через его статические зависимости. */
export function inspectStartupBundle(bundle: Record<string, { type: string }>) {
  const chunks = Object.values(bundle).filter((v): v is Chunk => v.type === 'chunk')
  const byName = new Map(chunks.map((c) => [c.fileName, c]))
  const entries = chunks.filter((c) => c.isEntry)
  const startup = new Set<string>()
  const visit = (c: Chunk) => {
    if (startup.has(c.fileName)) return
    startup.add(c.fileName)
    for (const name of c.imports) { const child = byName.get(name); if (child) visit(child) }
  }
  entries.forEach(visit)
  const errors: string[] = []
  const sizes = entries.map((c) => ({ file: c.fileName, bytes: Buffer.byteLength(c.code) }))
  if (!entries.length) errors.push('Не найден главный JS-чанк: проверка размера не выполнена')
  for (const entry of sizes) if (entry.bytes > MAIN_BUDGET_BYTES) errors.push(`${entry.file}: ${(entry.bytes / 1000).toFixed(2)} КБ, максимум ${MAIN_BUDGET_BYTES / 1000} КБ`)
  for (const name of startup) for (const id of Object.keys(byName.get(name)!.modules)) {
    if (/(?:^|[/\\])src[/\\]data[/\\](?:(?:labSteps|incidents|exercises|systemDesign)\.ts|packs[/\\][^/\\]+[/\\]pack\.ts)(?:\?.*)?$/.test(id)) errors.push(`Тяжёлые тексты снова в стартовой загрузке (${name}); подключайте их из lazy-страницы или карточки`)
  }
  return { entries: sizes, startup: [...startup], errors }
}

/** Vite может дополнить preload-код после generateBundle: проверяем и окончательные файлы. */
export async function inspectWrittenEntries(outDir: string, files: readonly string[]) {
  const sizes = await Promise.all(files.map(async (file) => ({ file, bytes: (await stat(path.join(outDir, file))).size })))
  return sizes.filter((entry) => entry.bytes > MAIN_BUDGET_BYTES).map((entry) => `${entry.file}: ${(entry.bytes / 1000).toFixed(2)} КБ после записи, максимум ${MAIN_BUDGET_BYTES / 1000} КБ`)
}

export function bundleBudgetPlugin(): Plugin {
  return {
    name: 'homeops-startup-budget', apply: 'build',
    generateBundle(_, bundle) {
      const audit = inspectStartupBundle(bundle)
      if (audit.errors.length) this.error('Стартовый бандл: ' + audit.errors.join('; '))
    },
    async writeBundle(options, bundle) {
      if (!options.dir) this.error('Не задана папка сборки: размер окончательного JS не проверен')
      const files = Object.values(bundle).filter((c) => c.type === 'chunk' && c.isEntry).map((c) => c.fileName)
      const errors = await inspectWrittenEntries(options.dir!, files)
      if (errors.length) this.error('Стартовый бандл: ' + errors.join('; '))
    },
  }
}
