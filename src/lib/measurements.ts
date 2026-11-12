import type { Measurement, MeasurementMetric } from '../types'

export const METRIC_LABEL: Record<MeasurementMetric, string> = {
  ttft: 'TTFT',
  throughput: 'Throughput',
  recall: 'recall@k',
  memory: 'Память',
}
export const METRIC_UNITS: Record<MeasurementMetric, string[]> = {
  ttft: ['мс', 'с'],
  throughput: ['tokens/s', 'requests/s'],
  recall: ['доля', '%'],
  memory: ['MiB', 'GiB', 'MB', 'GB'],
}
export function normalizeMeasurement(raw: unknown): Measurement | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Measurement>
  if (
    typeof r.id !== 'string' ||
    !r.id.trim() ||
    typeof r.taskId !== 'string' ||
    !r.taskId.trim() ||
    !Object.hasOwn(METRIC_LABEL, r.metric ?? '')
  )
    return null
  if (typeof r.value !== 'number' || !Number.isFinite(r.value) || r.value < 0) return null
  if (
    ['date', 'unit', 'model', 'hardware', 'conditions'].some(
      (key) =>
        typeof r[key as keyof Measurement] !== 'string' ||
        !String(r[key as keyof Measurement]).trim(),
    )
  )
    return null
  const day = new Date(r.date! + 'T12:00:00Z')
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(r.date!) ||
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== r.date
  )
    return null
  if (!METRIC_UNITS[r.metric!].includes(r.unit!)) return null
  if (
    r.metric === 'recall' &&
    ((r.unit === 'доля' && r.value > 1) || (r.unit === '%' && r.value > 100))
  )
    return null
  return {
    id: r.id,
    taskId: r.taskId,
    date: r.date!,
    metric: r.metric!,
    value: r.value,
    unit: r.unit!,
    model: r.model!,
    hardware: r.hardware!,
    conditions: r.conditions!,
  }
}

export function normalizeMeasurements(raw: unknown): Measurement[] {
  if (!Array.isArray(raw)) return []
  const result = new Map<string, Measurement>()
  for (const row of raw) {
    const value = normalizeMeasurement(row)
    if (value && !result.has(value.id)) result.set(value.id, value)
  }
  return [...result.values()]
}
export const measurementText = (m: Measurement): string =>
  `${METRIC_LABEL[m.metric]}: ${m.value} ${m.unit}; модель: ${m.model}; железо: ${m.hardware}; условия: ${m.conditions}; дата: ${m.date}`
