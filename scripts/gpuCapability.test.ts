import { describe, expect, it } from 'vitest'
import { NVIDIA_PROBE_ARGS, NVIDIA_PROBE_IMAGE, probeNvidia } from './gpuCapability'

describe('fixed NVIDIA capability probe', () => {
  it('does not pull an image or start a probe when the local image is absent', async () => {
    const calls: string[][] = []
    const result = await probeNvidia(async (args) => { calls.push(args); return { code: 1, stdout: '' } })
    expect(result.available).toBe(false)
    expect(result.reason).toContain('Mac')
    expect(calls).toEqual([['image', 'inspect', NVIDIA_PROBE_IMAGE]])
  })
  it('uses only fixed isolated args and accepts an actual successful GPU listing', async () => {
    const calls: string[][] = []
    const result = await probeNvidia(async (args) => {
      calls.push(args)
      return { code: 0, stdout: args[0] === 'run' ? 'NVIDIA GeForce RTX 4060\n' : '[{}]' }
    })
    expect(result).toEqual({ available: true, reason: '' })
    expect(calls[1]).toEqual([...NVIDIA_PROBE_ARGS])
    expect(calls[1]).toContain('--pull=never')
    expect(calls[1]).not.toContain('--privileged')
    expect(calls[1]).not.toContain('-v')
  })
  it.each([{ code: 1, stdout: 'NVIDIA GeForce RTX 4060' }, { code: 0, stdout: '' }, { code: 0, stdout: 'No devices were found' }])('rejects unavailable compute devices: $code/$stdout', async (response) => {
    expect((await probeNvidia(async (args) => args[0] === 'image' ? { code: 0, stdout: '[{}]' } : response)).available).toBe(false)
  })
  it('fails closed after an error', async () => {
    expect((await probeNvidia(async () => { throw new Error('timeout') })).available).toBe(false)
  })
})
