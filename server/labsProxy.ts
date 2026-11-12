// Потоковый HTTP-прокси к сервису стендов. Обрыв upstream завершает ответ без
// маркера результата: клиент покажет неизвестный результат и освободит кнопки.
import { request, type IncomingMessage, type ServerResponse } from 'node:http'

const LABS_DOWN = {
  error: 'Сервис стендов недоступен: запустите дашборд через docker compose up -d',
}

export function proxyLabs(
  req: IncomingMessage,
  res: ServerResponse,
  labsUrl: URL | null,
  timeoutMs = 330_000,
): void {
  const fail = () => {
    if (res.writableEnded || res.destroyed) return
    if (res.headersSent) res.end()
    else {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(LABS_DOWN))
    }
  }
  if (!labsUrl) return fail()
  const upstream = request(
    {
      host: labsUrl.hostname,
      port: labsUrl.port || 80,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (up) => {
      up.on('aborted', fail)
      up.on('error', fail)
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )
  const timer = setTimeout(
    () => upstream.destroy(new Error('Сервис стендов не ответил вовремя')),
    timeoutMs,
  )
  upstream.on('close', () => clearTimeout(timer))
  res.on('close', () => {
    clearTimeout(timer)
    upstream.destroy()
  })
  upstream.on('error', fail)
  req.pipe(upstream)
}
