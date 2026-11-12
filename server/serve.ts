// Production-сервер: статика из dist/ + API файлового хранилища прогресса
// + прокси /api/labs/* к сервису стендов инцидентов (LABS_URL), включая WebSocket терминала.
// Запуск: node server/serve.ts (Node 22.18+/24 исполняет TypeScript без сборки).

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import path from 'node:path'
import { createProgressApi } from './progressApi.ts'
import { proxyLabs } from './labsProxy.ts'

const root = path.resolve(process.env.STATIC_DIR ?? 'dist')
const dataDir = path.resolve(process.env.DATA_DIR ?? 'data')
const port = Number(process.env.PORT ?? 8080)
const api = createProgressApi({ dataDir, dataDirLabel: process.env.DATA_DIR_LABEL })
const labsUrl = process.env.LABS_URL ? new URL(process.env.LABS_URL) : null

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

async function resolveFile(urlPath: string): Promise<string> {
  const decoded = decodeURIComponent(urlPath)
  const candidate = path.normalize(path.join(root, decoded))
  if (candidate.startsWith(root + path.sep)) {
    try {
      if ((await stat(candidate)).isFile()) return candidate
    } catch {
      // нет такого файла — отдаём index.html
    }
  }
  return path.join(root, 'index.html')
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok\n')
      return
    }
    if (url.pathname.startsWith('/api/labs/')) return proxyLabs(req, res, labsUrl)
    if (await api(req, res)) return

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      res.end()
      return
    }
    const file = await resolveFile(url.pathname)
    const isAsset = file.startsWith(path.join(root, 'assets') + path.sep)
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...SECURITY_HEADERS,
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res)
  } catch {
    if (res.headersSent) res.destroy()
    else {
      res.writeHead(400, SECURITY_HEADERS)
      res.end('Некорректный адрес запроса')
    }
  }
})

// WebSocket терминала: пробрасываем upgrade-запрос и дальше байты в обе стороны
server.on('upgrade', (req, socket, head) => {
  if (!labsUrl || !req.url?.startsWith('/api/labs/')) {
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
    return
  }
  const connectTimer = setTimeout(() => {
    upstream.destroy()
    socket.destroy()
  }, 30_000)
  const upstream = connect(Number(labsUrl.port || 80), labsUrl.hostname, () => {
    clearTimeout(connectTimer)
    const lines = [`${req.method} ${req.url} HTTP/1.1`]
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (head.length) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  upstream.on('close', () => {
    clearTimeout(connectTimer)
    socket.destroy()
  })
  socket.on('close', () => {
    clearTimeout(connectTimer)
    upstream.destroy()
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
})

server.listen(port, '0.0.0.0', () => {
  console.log(`AI Infra Learning Dashboard: http://localhost:${port}  (data: ${dataDir})`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
