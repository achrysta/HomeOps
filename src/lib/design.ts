// System design: статус своего ответа и сводка по кейсам. Без React.

import { DESIGN_MIN_CHARS } from '../config/weights'
import type { DesignAnswer, DesignCase } from '../types'

export type DesignStatus = 'new' | 'draft' | 'checked'

export function designStatus(a: DesignAnswer | undefined): DesignStatus {
  if (!a) return 'new'
  return a.checkedAt ? 'checked' : 'draft'
}

/** Разбор открывается после собственного ответа: иначе сравнивать не с чем. */
export const canCheckDesign = (a: DesignAnswer | undefined): boolean => !!a && a.text.trim().length >= DESIGN_MIN_CHARS

export interface DesignCoverage {
  /** Отмечено вслепую, до разбора */
  before: number
  /** Отмечено после сверки (null — разбор ещё не открыт) */
  after: number | null
  total: number
}

export function designCoverage(a: DesignAnswer | undefined, aspectCount: number): DesignCoverage {
  return { before: a?.covered.length ?? 0, after: a?.checkedAt ? (a.coveredAfter ?? a.covered).length : null, total: aspectCount }
}

/** Сводка: сколько кейсов сверено с разбором и сколько в работе. */
export function summarizeDesigns(cases: readonly DesignCase[], designs: Record<string, DesignAnswer>): { checked: number; drafts: number; total: number } {
  const statuses = cases.map((c) => designStatus(designs[c.id]))
  return { checked: statuses.filter((s) => s === 'checked').length, drafts: statuses.filter((s) => s === 'draft').length, total: cases.length }
}
