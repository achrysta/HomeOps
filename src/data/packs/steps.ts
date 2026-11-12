// Пошаговые планы и самопроверки шагов пакетов контента (см. ./index.ts).
// Импортируется только из labSteps.ts — грузится лениво. У каждого шага плана — своя самопроверка.
import type { LabStepCheck } from '../labSteps'
import { checks as finetuningChecks, steps as finetuning } from './finetuning/steps'
import { checks as agentsChecks, steps as agents } from './agents/steps'
import { checks as pipelinesChecks, steps as pipelines } from './pipelines/steps'
import { checks as platformIacChecks, steps as platformIac } from './platform-iac/steps'

export const packLabSteps: Record<string, string[]> = { ...agents, ...pipelines, ...finetuning, ...platformIac }
export const packLabStepChecks: Record<string, LabStepCheck[]> = { ...agentsChecks, ...pipelinesChecks, ...finetuningChecks, ...platformIacChecks }
