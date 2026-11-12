import type { RegressionCase } from './incidentCases'

const LARGE = 'Qwen/Qwen2.5-3B-Instruct'
const SMALL = 'Qwen/Qwen2.5-0.5B-Instruct'
const LARGE_REV = 'aa8e72537993ba99e69dfaafa59ed015b17504d1'
const SMALL_REV = '7ae557604adf67be50417f59c2c2f167def9a775'
const runtime = (model: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  model, revision: model === LARGE ? LARGE_REV : SMALL_REV,
  gpu_memory_utilization: model === LARGE ? 0.85 : 0.35,
  max_model_len: 8192, max_num_seqs: 2, max_lora_rank: 32,
  enable_lora: false, adapter: 'none', ...extra,
}, null, 2) + '\n'
const file = (text: string) => [{ path: 'config/runtime.json', text }]
const result = (ready: boolean, request: boolean, constraints: boolean) => ({ gpu: true, ready, request, constraints })
const smallFiles = file(runtime(SMALL))

/** 25 стадий подтверждены на RTX 4060 / WSL; cache готовится до прогона. */
export const GPU_CASES: RegressionCase[] = [
  {
    id: 'gpu-vllm-budget', kind: 'compose', requires: 'nvidia-gpu',
    requiredImages: ['homeops-gpu-stand:1'], start: ['model', 'gateway'],
    stages: [
      { id: 'broken', title: 'Бюджет 0.90, отсутствующее model name', expected: result(false, false, false), messageIncludes: { ready: 'code=1', constraints: 'GPU-бюджет' } },
      { id: 'partial', title: 'Бюджет 0.85; gateway пока не выбирает обслуживаемую модель', files: file(runtime(LARGE)), expected: result(true, false, true) },
      { id: 'fixed', title: 'Исходная база и правильный маршрут gateway', files: [{ path: 'config/gateway.json', text: '{"model":"tickets-base"}\n' }], expected: result(true, true, true) },
      { id: 'bypass-small', title: 'Подмена базы меньшей моделью', files: smallFiles, expected: result(true, true, false) },
      { id: 'bypass-context', title: 'Срез контракта до 2K', files: file(runtime(LARGE, { max_model_len: 2048 })), expected: result(true, true, false) },
      { id: 'bypass-cpu', title: 'Скрытие CUDA процесса вместо выполнения на GPU', services: { model: { environment: { CUDA_VISIBLE_DEVICES: '' } } }, start: ['model', 'gateway'], files: file(runtime(LARGE)), expected: { gpu: false, ready: false, request: false, constraints: true } },
    ],
  },
  {
    id: 'gpu-kv-cache', kind: 'compose', requires: 'nvidia-gpu',
    requiredImages: ['homeops-gpu-stand:1'], start: ['model', 'gateway'],
    stages: [
      { id: 'broken', title: '32K превышает ёмкость KV', expected: result(false, false, false), messageIncludes: { ready: 'code=1', constraints: 'контекст 8192' } },
      { id: 'partial', title: 'Контекст 8K, но лимит последовательностей уменьшен', files: file(runtime(LARGE, { max_num_seqs: 1 })), expected: result(true, true, false) },
      { id: 'fixed', title: 'Измеренный 3B/0.85/8K/2 контракт', files: file(runtime(LARGE)), expected: result(true, true, true) },
      { id: 'bypass-small', title: 'Уменьшение модели вместо исходной базы', files: smallFiles, expected: result(true, true, false) },
      { id: 'bypass-context', title: 'Контекст меньше обязательных 8K', files: file(runtime(LARGE, { max_model_len: 2048 })), expected: result(true, true, false) },
      { id: 'bypass-seqs', title: 'Лимит активных последовательностей изменён', files: file(runtime(LARGE, { max_num_seqs: 1 })), expected: result(true, true, false) },
      { id: 'bypass-budget', title: 'GPU-бюджет снова выше допустимого', files: file(runtime(LARGE, { gpu_memory_utilization: 0.90 })), expected: result(false, false, false), messageIncludes: { ready: 'code=1', constraints: 'GPU-бюджет' } },
    ],
  },
  {
    id: 'gpu-container', kind: 'compose', requires: 'nvidia-gpu',
    requiredImages: ['homeops-gpu-stand:1'], start: ['model', 'gateway'],
    stages: [
      { id: 'broken', title: 'Нет GPU allocation и CUDA visibility', expected: { visible: false, gpu: false, ready: false, request: false, constraints: true } },
      { id: 'partial', title: 'GPU передан контейнеру, но скрыт от процесса', services: { model: { gpus: 'all' } }, start: ['model', 'gateway'], expected: { visible: true, gpu: false, ready: false, request: false, constraints: true } },
      { id: 'fixed', title: 'NVML и CUDA compute видят назначенный GPU', services: { model: { gpus: 'all', environment: { CUDA_VISIBLE_DEVICES: '0' } } }, start: ['model', 'gateway'], expected: { visible: true, gpu: true, ready: true, request: true, constraints: true } },
      { id: 'bypass-model', title: 'База подменена другой', files: file(runtime(LARGE)), expected: { visible: true, gpu: true, ready: true, request: true, constraints: false } },
      { id: 'bypass-context', title: 'Срез контекста вместо полного контракта', files: file(runtime(SMALL, { max_model_len: 2048 })), expected: { visible: true, gpu: true, ready: true, request: true, constraints: false } },
      { id: 'bypass-cpu', title: 'NVML работает, CUDA compute скрыт', services: { model: { environment: { CUDA_VISIBLE_DEVICES: '' } } }, start: ['model', 'gateway'], files: smallFiles, expected: { visible: true, gpu: false, ready: false, request: false, constraints: true } },
    ],
  },
  {
    id: 'gpu-lora', kind: 'compose', requires: 'nvidia-gpu',
    requiredImages: ['homeops-gpu-stand:1'], start: ['model', 'gateway'],
    stages: [
      { id: 'broken', title: 'Rank превышен, адаптер от другой базы', expected: { gpu: true, rank: false, ready: false, adapter: false, constraints: true } },
      { id: 'partial', title: 'Rank разрешён, shapes другой базы всё ещё несовместимы', files: file(runtime(SMALL, { enable_lora: true, adapter: 'wrong' })), expected: { gpu: true, rank: true, ready: false, adapter: false, constraints: true } },
      { id: 'fixed', title: 'Rank и base revision совместимы', files: file(runtime(SMALL, { enable_lora: true, adapter: 'correct' })), expected: { gpu: true, rank: true, ready: true, adapter: true, constraints: true } },
      { id: 'bypass-disable', title: 'LoRA отключена и обслуживается одна база', files: smallFiles, expected: { gpu: true, rank: true, ready: true, adapter: false, constraints: false } },
      { id: 'bypass-context', title: 'Адаптер работает, но контекст срезан', files: file(runtime(SMALL, { enable_lora: true, adapter: 'correct', max_model_len: 2048 })), expected: { gpu: true, rank: true, ready: true, adapter: true, constraints: false } },
      { id: 'bypass-cpu', title: 'Уход с CUDA не принимается', files: file(runtime(SMALL, { enable_lora: true, adapter: 'correct' })), services: { model: { environment: { CUDA_VISIBLE_DEVICES: '' } } }, start: ['model', 'gateway'], expected: { gpu: false, rank: true, ready: false, adapter: false, constraints: true } },
    ],
  },
]
