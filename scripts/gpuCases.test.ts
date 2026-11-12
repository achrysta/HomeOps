import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { incidents } from '../src/data/incidents'
import { composeRequiresNvidia } from '../server/labs.ts'
import { GPU_CASES } from './gpuCases.ts'

// Флаг UI, отказ labs и hardware-skip runner должны описывать один и тот же стенд.
describe('NVIDIA stand catalogue contract', () => {
  it('masks model weights in the CPU live helper while preserving model cache access', () => {
    for (const test of GPU_CASES) {
      const compose = readFileSync(`incidents/${test.id}/compose.yaml`, 'utf8')
      const helper = compose.split('  live:\n')[1]?.split('\n  verify:')[0]
      expect(helper, test.id).toBeTruthy()
      expect(helper, test.id).toMatch(/tmpfs:\s*\n\s*- \/gpu\/models:ro,/)
      expect(helper, test.id).not.toMatch(/gpus:|:\/models:ro/)
      expect(compose.split('  live:\n')[0], test.id).toContain('../_shared/gpu/models:/models:ro')
    }
  })
  it('preserves the persistent helper when gpu-container reset restores Compose', () => {
    const original = readFileSync('incidents/gpu-container/.original/compose.yaml', 'utf8')
    const initial = readFileSync('incidents/gpu-container/compose.yaml', 'utf8')
    expect(original).toBe(initial)
    expect(original).toContain('homeops.live: gpu')
  })
  it('keeps metadata, Compose capability and regression requirements consistent', () => {
    expect(incidents.filter((i) => i.requires === 'nvidia-gpu').map((i) => i.id).sort()).toEqual(GPU_CASES.map((c) => c.id).sort())
    for (const test of GPU_CASES) {
      expect(test.requires).toBe('nvidia-gpu')
      const compose = readFileSync(`incidents/${test.id}/compose.yaml`, 'utf8')
      expect(composeRequiresNvidia(compose), test.id).toBe(true)
      expect(compose).toContain('homeops.terminal:')
      const incident = incidents.find((i) => i.id === test.id)!
      for (const stage of test.stages) expect(Object.keys(stage.expected).sort(), `${test.id}/${stage.id}`).toEqual(incident.checks.map((c) => c.id).sort())
    }
  })
})
