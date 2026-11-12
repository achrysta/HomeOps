/** Фиксированная диагностика NVIDIA; никакие аргументы клиента сюда не передаются.
 * Только локальный образ, без сети, bind mounts, privilege и публикации портов.
 */
export const NVIDIA_PROBE_IMAGE = 'nvidia/cuda:12.8.1-base-ubuntu24.04'
export const NVIDIA_PROBE_ARGS = [
  'run', '--rm', '--pull=never', '--network', 'none', '--gpus', 'all',
  '--entrypoint', 'nvidia-smi', NVIDIA_PROBE_IMAGE,
  '--query-gpu=name', '--format=csv,noheader',
] as const

export interface NvidiaCapability { available: boolean; reason: string }
type Result = { code: number; stdout: string }

export async function probeNvidia(run: (args: string[]) => Promise<Result>): Promise<NvidiaCapability> {
  const missing = 'Нужна NVIDIA GPU, доступная в Docker. На Mac CUDA в контейнере недоступна; используйте Windows/WSL с NVIDIA.'
  try {
    const image = await run(['image', 'inspect', NVIDIA_PROBE_IMAGE])
    if (image.code !== 0) return { available: false, reason: `${missing} Проверочный CUDA-образ ещё не загружен: ${NVIDIA_PROBE_IMAGE}.` }
    const result = await run([...NVIDIA_PROBE_ARGS])
    const found = result.stdout.split('\n').some((line) => /^(NVIDIA|GeForce|Tesla|Quadro|RTX|[ABHLT]\d)/.test(line.trim()))
    return result.code === 0 && found
      ? { available: true, reason: '' }
      : { available: false, reason: missing }
  } catch {
    return { available: false, reason: `${missing} Диагностика Docker не завершилась успешно.` }
  }
}
