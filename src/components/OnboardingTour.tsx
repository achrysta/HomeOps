import { CircleHelp } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { navigate, type Page } from '../state/router'
import { useLocalState } from '../state/useLocalState'
import { Button, Drawer } from './ui'

const STEPS: { title: string; text: string; page: Page; params?: Record<string, string> }[] = [
  {
    title: 'Сегодня',
    text: 'Начните с главного шага и одного рекомендуемого формата. Другие форматы — под «Ещё практика». Подтверждённые результаты приходят из задач и проверок, а не из открытия страницы.',
    page: 'dashboard',
  },
  {
    title: 'Свой опыт',
    text: 'По умолчанию все уровни нулевые. Откройте «Навыки», выберите навык и укажите самооценку с обоснованием — где и что делали. Без обоснования самооценка не учитывается.',
    page: 'vacancy',
  },
  {
    title: 'Дорожная карта',
    text: 'Выберите трек и откройте задачу. Время начнёт считаться после «В работе»; зачёт требует критериев приёмки и подтверждения.',
    page: 'roadmap',
  },
  {
    title: 'Материалы',
    text: 'Ссылки на чтение по трекам, а на вкладке «Конспекты и шпаргалки» — выжимки на десять минут и переходы в стенд, зал или упражнение по тому же инструменту.',
    page: 'cheatsheets',
  },
  {
    title: 'Входная диагностика',
    text: 'Открывается на вкладке «Тесты» дорожной карты: карта ответов и рекомендации по чтению. Она не меняет уровни навыков, предыдущие задачи и прогресс.',
    page: 'diagnostics',
  },
  {
    title: 'Стенды и тренажёр',
    text: 'Стенды — сломанные системы в Docker: инциденты и залы с автопроверкой. Тренажёр — вопросы и упражнения со сразу видимым разбором, ответы вслух со сверкой по тезисам («Своими словами») и кейсы проектирования.',
    page: 'incidents',
  },
  {
    title: 'Прогресс и резервная копия',
    text: '«Навыки» показывают, насколько подтверждённые навыки закрывают профиль роли. Файл прогресса — источник истины; резервная копия помогает переносить и восстанавливать записи.',
    page: 'data',
  },
]
export function OnboardingTour() {
  const [seen, setSeen] = useLocalState('onboarding.v1', false)
  const [manual, setManual] = useState(false)
  const [index, setIndex] = useState(0)
  const open = manual || !seen
  const close = () => {
    setSeen(true)
    setManual(false)
  }
  const step = STEPS[index]
  return (
    <>
      <button
        type="button"
        className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
        aria-label="Краткий тур"
        title="Краткий тур"
        onClick={() => {
          setIndex(0)
          setManual(true)
        }}
      >
        <CircleHelp size={16} />
      </button>
      {typeof document !== 'undefined' &&
        createPortal(
          <Drawer open={open} onClose={close} title="Как пользоваться HomeOps">
            <div className="rounded-2xl border border-accent/20 bg-accent/[0.05] p-5">
              <div className="mb-3 text-xs text-subtle">
                Шаг {index + 1} из {STEPS.length}
              </div>
              <h2 className="mb-3 text-xl font-semibold text-fg">{step.title}</h2>
              <p className="text-sm leading-relaxed text-muted">{step.text}</p>
              <Button className="mt-4" onClick={() => navigate(step.page, step.params)}>
                Открыть раздел
              </Button>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="lg"
                onClick={() => (index === STEPS.length - 1 ? close() : setIndex((i) => i + 1))}
              >
                {index === STEPS.length - 1 ? 'Понятно' : 'Дальше'}
              </Button>
              {index > 0 && <Button onClick={() => setIndex((i) => i - 1)}>Назад</Button>}
              <Button variant="ghost" onClick={close}>
                Пропустить тур
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted">
              Повторно открыть тур можно кнопкой «?» в верхней панели. Прогресс обучения от тура не
              меняется.
            </p>
          </Drawer>,
          document.body,
        )}
    </>
  )
}
