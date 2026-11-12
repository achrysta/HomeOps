import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '..')

/** Локальные модули сервера, которые подтягивает точка входа (import './x.ts'), включая её саму. */
function closure(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen
  seen.add(entry)
  const src = readFileSync(path.join(ROOT, 'server', entry), 'utf8')
  for (const m of src.matchAll(/from '\.\/([\w.-]+\.ts)'/g)) closure(m[1], seen)
  return seen
}

describe('Dockerfile', () => {
  // Образ копирует серверные файлы поимённо: забытый модуль роняет контейнер при старте
  it('copies every server module the entry points import', () => {
    const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8')
    const copied = new Set([...dockerfile.matchAll(/server\/([\w.-]+\.ts)/g)].map((m) => m[1]))
    for (const entry of ['serve.ts', 'labs-serve.ts']) {
      for (const file of closure(entry)) expect(copied.has(file), `Dockerfile не копирует server/${file} (нужен ${entry})`).toBe(true)
    }
  })
})
