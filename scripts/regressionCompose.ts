import path from 'node:path'

interface Mount { type: string; source: string; target: string; read_only?: boolean }
interface Service {
  image?: string; build?: unknown; container_name?: string; ports?: unknown; network_mode?: string
  environment?: Record<string, string>; labels?: Record<string, string>; volumes?: Mount[]
  [key: string]: unknown
}
export interface RegressionCompose {
  services: Record<string, Service>
  volumes?: Record<string, { name?: string; external?: boolean; labels?: Record<string, string> }>
  networks?: Record<string, { name?: string; external?: boolean }>
  [key: string]: unknown
}

/** Нормализованный Compose: все записи/порты/тома отделены от пользовательских. */
export function isolateCompose(raw: RegressionCompose, work: string, hostWork: string, project: string, owner: string, offline = false): RegressionCompose {
  const result = structuredClone(raw)
  delete result.name
  for (const service of Object.values(result.services)) {
    delete service.build
    delete service.container_name
    delete service.ports
    if (service.network_mode === 'host') throw new Error('Сеть host в автопрогоне запрещена')
    if (offline) { delete service.networks; service.network_mode = 'none' }
    service.environment = { ...service.environment, DASHBOARD_URL: 'off' }
    service.labels = { 'homeops.regression.run': owner }
    for (const mount of service.volumes ?? []) {
      if (mount.type !== 'bind') continue
      // Единственный системный bind — cgroup учебного systemd-сервера.
      if (mount.source === '/sys/fs/cgroup' && mount.target === '/sys/fs/cgroup') continue
      const relative = path.relative(work, mount.source)
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Bind вне тестовой копии: ${mount.source}`)
      mount.source = path.join(hostWork, relative)
    }
  }
  for (const [key, volume] of Object.entries(result.volumes ?? {})) {
    if (volume.external) throw new Error(`Внешний том запрещён: ${key}`)
    volume.name = `${project}-${key}`
    volume.labels = { 'homeops.regression.run': owner }
  }
  for (const [key, network] of Object.entries(result.networks ?? {})) {
    if (network.external) throw new Error(`Внешняя сеть запрещена: ${key}`)
    network.name = `${project}-${key}`
  }
  return result
}
