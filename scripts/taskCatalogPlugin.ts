import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import { normalizePath, type Plugin } from 'vite'
import { incidentMetadata } from './incidentMetadata.ts'
import { designMetadata, exerciseMetadata, packMetadata, readCatalogData, readPack } from './packMetadata.ts'

const id = 'virtual:homeops-plan-metadata'
const incidentId = 'virtual:homeops-incident-catalog'
const packId = 'virtual:homeops-pack-catalog'
const exerciseId = 'virtual:homeops-exercise-catalog'
const designId = 'virtual:homeops-design-catalog'
const fullStore = fileURLToPath(new URL('../src/components/useContentStore.ts', import.meta.url))
const staticComponents = new Set(['Layout', 'TodayPlan', 'ProgressAvailability', 'useContentStore'])

export function needsFullContent(from: string): boolean {
  return /\/src\/pages\/(?!DashboardPage)[^/]+\.tsx$/.test(from) ||
    /\/src\/components\/[^/]+\.tsx$/.test(from) && !staticComponents.has(path.basename(from, '.tsx'))
}
/** Исходные файлы прежние. Production берёт метаданные; lazy-карточка/страница — полные тексты. */
export function taskCatalogPlugin(): Plugin {
  let metadataOnly = false
  return {
    name: 'homeops-task-catalog', enforce: 'pre',
    configResolved(config) { metadataOnly = config.command === 'build' },
    resolveId(source, importer) {
      if (!metadataOnly || !importer) return
      const from = normalizePath(importer).split('?')[0]
      if (from.endsWith('/src/data/index.ts') && source === './exercises') return '\0' + exerciseId
      if (from.endsWith('/src/data/index.ts') && source === './systemDesign') return '\0' + designId
      if (source === '../state/context' && needsFullContent(from)) return fullStore
      if (/\/src\/data\/(curriculum|skills|resources|interview)\.ts$/.test(from) && source === './packs') return '\0' + packId
      if (from.endsWith('/src/data/packs/estimates.ts') && source === './index') return '\0' + packId
      // Ограниченные рёбра стартового графа; lazy-страницы импортируют полные исходники.
      if (from.endsWith('/src/data/index.ts') && source === './labSteps') return '\0' + id
      if ((from.endsWith('/src/data/index.ts') && source === './incidents') || (from.endsWith('/src/state/reducer.ts') && source === '../data/incidents')) return '\0' + incidentId
    },
    async load(source) {
      if (source === '\0' + exerciseId || source === '\0' + designId) {
        const exercise = source === '\0' + exerciseId
        const file = fileURLToPath(new URL(exercise ? '../src/data/exercises.ts' : '../src/data/systemDesign.ts', import.meta.url))
        this.addWatchFile(file)
        const data = await readFile(file, 'utf8')
        if (exercise) return `export const exerciseSets = ${JSON.stringify(exerciseMetadata(readCatalogData(data, 'exerciseSets') as Parameters<typeof exerciseMetadata>[0]))}`
        return `export const designAspects = ${JSON.stringify(readCatalogData(data, 'designAspects'))}; export const designCases = ${JSON.stringify(designMetadata(readCatalogData(data, 'designCases') as Parameters<typeof designMetadata>[0]))}`
      }
      if (source === '\0' + packId) {
        const index = fileURLToPath(new URL('../src/data/packs/index.ts', import.meta.url))
        this.addWatchFile(index)
        const text = await readFile(index, 'utf8')
        const entries = [...text.matchAll(/import \{ pack as (\w+) \} from '(\.\/[^']+)'/g)]
        const metadata = await Promise.all(entries.map(async ([, alias, relative]) => {
          const file = path.resolve(path.dirname(index), relative + '.ts')
          this.addWatchFile(file)
          return `const ${alias} = ${JSON.stringify(packMetadata(readPack(await readFile(file, 'utf8'))))};`
        }))
        const module = text.replace(/^import \{ pack as \w+ \} from '\.\/[^']+'\n/gm, '')
        return ts.transpileModule(metadata.join('\n') + '\n' + module, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
      }
      if (source === '\0' + incidentId) {
        const full = fileURLToPath(new URL('../src/data/incidents.ts', import.meta.url))
        this.addWatchFile(full)
        return `export const incidents = ${JSON.stringify(incidentMetadata(await readFile(full, 'utf8')))}`
      }
      if (source !== '\0' + id) return
      return 'export const labSteps = {}'
    },
  }
}
