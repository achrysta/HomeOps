import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
it('returns 400 for invalid percent encoding and keeps the production server alive', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'homeops-serve-review-'))
  await writeFile(path.join(dir, 'index.html'), '<h1>Test preview</h1>')
  const child = spawn(process.execPath, ['server/serve.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: '18098',
      DATA_DIR: path.join(dir, 'store'),
      STATIC_DIR: dir,
      LABS_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve())
      child.once('error', reject)
      child.once('exit', (code) => reject(new Error('Server exited: ' + code)))
    })
    expect((await fetch('http://127.0.0.1:18098/%ZZ')).status).toBe(400)
    expect(await (await fetch('http://127.0.0.1:18098/healthz')).text()).toBe('ok\n')
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = new Promise<void>((r) => child.once('exit', () => r()))
      child.kill('SIGTERM')
      await exit
    }
    await rm(dir, { recursive: true, force: true })
  }
})
