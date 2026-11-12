/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Connect, type Plugin } from 'vite'
import { createProgressApi } from './server/progressApi.ts'
import { taskCatalogPlugin } from './scripts/taskCatalogPlugin.ts'
import { bundleBudgetPlugin } from './scripts/bundleBudget.ts'

/** Файловое хранилище прогресса (data/progress.json) в dev- и preview-сервере Vite. */
function progressApi(): Plugin {
  const api = createProgressApi({
    dataDir: fileURLToPath(new URL('./data', import.meta.url)),
    dataDirLabel: 'data',
  })
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    void api(req, res, next)
  }
  return {
    name: 'progress-api',
    configureServer: (server) => {
      server.middlewares.use(middleware)
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), progressApi(), taskCatalogPlugin(), bundleBudgetPlugin()],
  server: {
    port: 5173,
    host: true,
    // запись progress.json и отчёты стендов не должны вызывать перезагрузку страницы
    watch: { ignored: ['**/data/**', '**/incidents/**'] },
    // Сервис стендов инцидентов из docker compose (порт 8091 на localhost), включая WebSocket терминала
    proxy: { '/api/labs': { target: 'http://127.0.0.1:8091', ws: true } },
  },
  preview: { port: 4173, host: true },
  // Локальное приложение; заметная часть бандла — текстовые данные программы (вопросы, материалы).
  build: {
    // Позволяет npm run check собирать в изолированную папку при параллельной работе.
    outDir: process.env.HOMEOPS_BUILD_OUT_DIR ?? 'dist',
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'mlops-banks', test: /[\\/]src[\\/]data[\\/]drills[\\/]ml-/ },
            // DevOps-база — два чанка по разделам, чтобы каждый оставался ниже порога предупреждения 1200 КБ.
            // Банк раздела «Базы данных и очереди» добавлять в этот список, остальные попадают в infra.
            { name: 'devops-data-banks', test: /[\\/]src[\\/]data[\\/]drills[\\/](?:db|pg|mysql|mongo|redis|clickhouse|kafka)\.ts$/ },
            { name: 'devops-infra-banks', test: /[\\/]src[\\/]data[\\/]drills[\\/](?!ml-|(?:db|pg|mysql|mongo|redis|clickhouse|kafka)\.ts$)/ },
            { name: 'track-quizzes', test: /[\\/]src[\\/]data[\\/](quizzes\.ts|packs[\\/](quizzes\.ts|[^\\/]+[\\/]quiz\.ts))$/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
