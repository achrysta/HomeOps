import type { TrackLesson } from './trackLessonFormat'

/** Конспект трека J — чтение без отметки и без влияния на зачёт. */
export const trackJLesson: TrackLesson = {
  code: 'J', trackId: 'finetuning',
  title: 'Дообучение: данные, адаптер, проверка и откат',
  minutes: 14,
  intro: 'Дообучение меняет поведение модели — формат, стиль, выбор категорий, — но не добавляет управляемых актуальных знаний: для фактов есть RAG. Перед LoRA измерьте baseline с prompt и проверкой схемы: часто этого хватает. На Mac в Docker проходят данные, маленькая CPU-LoRA и eval; QLoRA и multi-LoRA в vLLM — на RTX 4060 в WSL. CPU-путь не подтверждает опыт CUDA.',
  sections: [
    {
      title: '1. Что меняет адаптер и когда он нужен',
      rule: 'Нужны актуальные факты → RAG; стабильный формат → сначала prompt, проверка схемы и замер baseline; поведение, которого не добиться prompt, → адаптер. LoRA замораживает базу и учит низкоранговое обновление для target_modules: r — ранг, lora_alpha — масштаб. QLoRA держит базу в 4 битах NF4 и учит тот же адаптер поверх неё.',
      choices: [['Ответы должны опираться на свежую базу знаний', 'RAG: источники обновляются без обучения'], ['Модель путает категории при хорошем prompt', 'Адаптер на размеченных примерах'], ['База не помещается в 8 ГБ для обучения', 'QLoRA: 4-битная база, обучаемый адаптер']],
      command: 'docker compose run --rm train-cpu cat configs/cpu-lora.json',
      scope: 'В Compose проекта дообучения из ai-platform-labs (план J1.1); имена сервисов сверяйте со своим compose.yaml.',
      check: 'Назовите r, lora_alpha и target_modules своего конфига и долю обучаемых параметров из print_trainable_parameters(). Объясните, почему baseline измеряют до обучения.',
      mistakes: ['Дообучать модель знаниям, которые меняются каждую неделю.', 'Считать, что больший rank гарантирует лучшее качество.', 'Ожидать, что QLoRA хранит в 4 битах и адаптер, и все активации.'],
      taskIds: ['J1'], cheatsheetIds: ['lora'],
    },
    {
      title: '2. Данные: split до обучения, шаблон один раз',
      rule: 'Split по источникам до любой обработки и дедупликация между train, validation и test: почти одинаковые тикеты в разных частях завышают оценку. Learning rate и число эпох выбирают по validation, test открывают один раз. Chat template базовой модели применяют один раз, special tokens не задваивают, loss считают по ответу assistant.',
      choices: [['Почти одинаковые тикеты из одного источника', 'Держать источник целиком в одной части split'], ['Подбор learning rate и эпох', 'По validation, test не трогать'], ['Train loss падает, validation растёт', 'Признак переобучения: меньше эпох или больше данных']],
      command: 'docker compose run --rm train-cpu python -m finetuning.validate data/',
      check: 'Валидатор JSONL не находит битых строк и пересечений между частями; в токенизированном примере видно, что маска loss начинается с ответа assistant.',
      mistakes: ['Делить данные случайно по строкам, когда в них есть дубли.', 'Применять chat template и затем ещё раз добавлять special tokens токенизатором.', 'Выбирать эпоху по test-выборке.'],
      taskIds: ['J1.1'], exerciseIds: ['ex-platform-finetune'],
    },
    {
      title: '3. Запуск: воспроизводимо и в своём бюджете памяти',
      rule: 'Один конфиг — один run в MLflow: seed, git sha, хэши данных, revision базы, r, alpha, target_modules, длина, micro-batch и accumulation. Effective batch = micro-batch × accumulation × число GPU. 4-битная база не спасает от OOM, если велики длина последовательности и активации: уменьшайте длину и micro-batch, включайте gradient checkpointing.',
      choices: [['OOM на RTX 4060', 'Короче sequence length, micro-batch 1, gradient checkpointing'], ['Нужен батч 4 при micro-batch 1', 'Gradient accumulation 4'], ['Два запуска нельзя сравнить', 'Одинаковый split, записанные хэши, revision и параметры']],
      command: 'docker compose run --rm train-gpu python -m finetuning.train --config configs/qlora.json',
      scope: 'В WSL на ноутбуке с RTX 4060. На Mac — train-cpu с configs/cpu-lora.json: это проверка пути данных, а не замер CUDA.',
      check: 'Адаптер сохранён, база заморожена; в MLflow два run на одинаковом split, записаны пик VRAM, время и loss.',
      mistakes: ['Выдавать CPU-LoRA на Mac за опыт QLoRA на NVIDIA.', 'Переносить бюджет памяти inference vLLM на обучение.', 'Не фиксировать revision базы: через месяц адаптер будет не к чему подключить.'],
      taskIds: ['J2'], cheatsheetIds: ['lora'],
    },
    {
      title: '4. Eval: адаптер против baseline в одинаковых условиях',
      rule: 'Baseline и адаптер проверяют одним набором, evaluator и decoding; набор не пересекается с обучением и имеет сохранённый хэш. Смотрят целевую метрику, негативные кейсы, общую способность, latency и стоимость. Решение — по порогам, заданным до запуска, в decision record; адаптер, не улучшивший eval, — тоже честный результат.',
      choices: [['Формат JSON лучше, отказы хуже', 'Отклонить или доработать: регрессия на негативных кейсах'], ['Judge видит, какой ответ от адаптера', 'Слепое сравнение без меток моделей'], ['Красивый пример в чате', 'Не аргумент: нужен результат по набору']],
      command: 'docker compose run --rm eval python -m eval.compare_adapters --baseline configs/base.json --candidate configs/adapter.json',
      check: 'Есть результаты по кейсам и срезам, регрессии общей способности и decision record с порогами, принятыми до запуска.',
      mistakes: ['Менять decoding или evaluator между baseline и адаптером.', 'Сдвигать пороги после того, как увидели результат.', 'Считать падение train loss доказательством качества.'],
      taskIds: ['J3'],
    },
    {
      title: '5. Serving и откат: адаптер привязан к базе',
      rule: 'Версия адаптера — PEFT-веса плюс base revision, tokenizer, хэш данных и git sha. vLLM обслуживает несколько адаптеров одной базы: --enable-lora, max-lora-rank не меньше rank адаптера, max-loras — сколько адаптеров активно в батче; клиент выбирает адаптер именем в model. Неизвестное имя отклоняют, а не отправляют молча на базу. Откат — переключение на предыдущий адаптер при неизменной базе.',
      choices: [['Два клиента — два адаптера одной базы', 'Multi-LoRA: --enable-lora и выбор адаптера по имени'], ['Адаптер обучен на другой revision базы', 'Не подключать: обучить заново на нужной базе'], ['Candidate провалил smoke', 'Champion не переключать, трафик остаётся на прошлом адаптере']],
      command: 'docker compose run --rm pipeline python -m pipeline.rollback',
      check: 'Проваленный eval блокирует champion; smoke candidate идёт в новом процессе до переключения трафика; rollback возвращает прошлый адаптер, база не меняется.',
      mistakes: ['Сливать адаптер с базой, когда нужен выбор адаптера на запрос.', 'Направлять запросы с неизвестным адаптером на базу без ошибки.', 'Хранить адаптер в реестре без base revision и tokenizer.'],
      taskIds: ['J4', 'J5'], incidentIds: ['gpu-lora'],
    },
  ],
}
