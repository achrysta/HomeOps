// Общие ограничения локального HTTP API: защита от CSRF и DNS rebinding.
import type { IncomingMessage } from 'node:http'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
/** Имена, под которыми сервис доступен изнутри docker compose дашборда */
const INTERNAL_HOSTS = new Set(['labs', 'dashboard'])

function hostOf(value: string): string {
  const v = value.toLowerCase()
  if (v.startsWith('[')) return v.slice(0, v.indexOf(']') + 1)
  return v.split(':')[0]
}

/** Запрос пришёл с этой машины и не с чужого сайта. */
export function isAllowedRequest(
  headers: IncomingMessage['headers'],
  internalHosts: readonly string[] = [],
): boolean {
  const host = headers.host ?? ''
  if (!/^(?:[a-z0-9.-]+|\[::1\])(?::[0-9]{1,5})?$/i.test(host)) return false
  const port = host.startsWith('[')
    ? host.slice(host.indexOf(']') + 1)
    : host.slice(host.indexOf(':') >= 0 ? host.indexOf(':') : host.length)
  if (port && (Number(port.slice(1)) < 1 || Number(port.slice(1)) > 65535)) return false
  const name = hostOf(host)
  if (
    !LOCAL_HOSTS.has(name) &&
    !INTERNAL_HOSTS.has(name) &&
    !internalHosts.includes(name) &&
    !name.endsWith('.localhost')
  )
    return false
  const origin = headers.origin
  if (!origin) return true
  try {
    const o = new URL(origin)
    return (
      ['http:', 'https:'].includes(o.protocol) &&
      !o.username &&
      !o.password &&
      o.pathname === '/' &&
      !o.search &&
      !o.hash &&
      (LOCAL_HOSTS.has(o.hostname) ||
        o.hostname.endsWith('.localhost') ||
        o.hostname === '[::1]') &&
      o.host === host.toLowerCase()
    )
  } catch {
    return false
  }
}
