// Сервис стендов инцидентов (отдельный контейнер `labs` в docker-compose.yml).
// Запуск: node server/labs-serve.ts. Нужны docker CLI с плагином compose и сокет Docker.

import { createServer } from 'node:http'
import path from 'node:path'
import { createLabsApi } from './labs.ts'

const port = Number(process.env.PORT ?? 8090)
const labs = createLabsApi({
  incidentsDir: path.resolve(process.env.INCIDENTS_DIR ?? 'incidents'),
  dockerSocket: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
  dashboardUrl: process.env.DASHBOARD_URL_INTERNAL,
})

const server = createServer((req, res) => {
  let url: URL
  try {
    url = new URL(req.url ?? '/', 'http://localhost')
  } catch {
    res.writeHead(400)
    res.end()
    return
  }
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok\n')
    return
  }
  void labs.handle(req, res)
})
server.on('upgrade', (req, socket, head) => void labs.handleUpgrade(req, socket, head))
server.listen(port, '0.0.0.0', () => console.log(`Сервис стендов инцидентов: :${port}`))

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
