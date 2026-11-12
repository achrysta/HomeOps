import { describe, expect, it } from 'vitest'
import { sanitizeReport } from './incidentReports.ts'
describe('review: incident inbox', () => {
  const raw = {
    format: 'homeops-incident-report',
    id: '12345678',
    incidentId: 'example',
    at: '2026-10-08T12:00:00Z',
    checks: [{ id: 'health', ok: true }],
  }
  it('rejects duplicate ids, future time and truncation of an excessive list', () => {
    expect(
      typeof sanitizeReport({ ...raw, checks: [...raw.checks, { id: 'health', ok: false }] }),
    ).toBe('string')
    expect(typeof sanitizeReport({ ...raw, at: new Date(Date.now() + 60000).toISOString() })).toBe(
      'string',
    )
    expect(
      typeof sanitizeReport({
        ...raw,
        checks: Array.from({ length: 51 }, (_, i) => ({ id: String(i), ok: true })),
      }),
    ).toBe('string')
    expect(sanitizeReport(raw)).toMatchObject({ passed: true })
  })
})
