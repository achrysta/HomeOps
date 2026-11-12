import type { Drill } from '../../types'
import { ansible } from './ansible'
import { bash } from './bash'
import { cicd } from './cicd'
import { clickhouse } from './clickhouse'
import { db } from './db'
import { disk } from './disk'
import { docker } from './docker'
import { git } from './git'
import { k8s } from './k8s'
import { kafka } from './kafka'
import { linux } from './linux'
import { mlAgents } from './ml-agents'
import { mlFinetune } from './ml-finetune'
import { mlGpu } from './ml-gpu'
import { mlServing } from './ml-serving'
import { mlK8s } from './ml-k8s'
import { mlPipelines } from './ml-pipelines'
import { mongo } from './mongo'
import { mysql } from './mysql'
import { net } from './net'
import { obs } from './obs'
import { pg } from './pg'
import { redis } from './redis'
import { terraform } from './terraform'

// Банки вопросов для повторения в тренажёре: «DevOps-база» и «MLOps-база» (area: 'ml').
// Не входят в прогресс обучения и соответствие роли.
// Правила те же, что для тестов: правильный ответ не угадывается по форме (см. AGENTS.md).
export const drills: Drill[] = [
  linux, disk, bash, net, docker, k8s, cicd, git, ansible, terraform, obs,
  db, pg, mysql, mongo, redis, clickhouse, kafka,
  mlPipelines, mlK8s, mlAgents, mlServing, mlGpu, mlFinetune,
]

export { DRILL_AREAS, DRILL_GROUPS } from './areas'
