import { useState } from 'react'
import { guidedLabTasks, labQuestions, labStepChecks, type LabQuestion } from '../data/labSteps'
import { checkOutput, commandHints, hideCommands } from '../lib/labStepPractice'
import type { TaskDef } from '../types'
import { CopyCommand } from './CopyCommand'
import { InlineText } from './InlineText'
import { Badge, Button, InfoTip } from './ui'

export function LabStepPlan({ task }: { task: TaskDef }) {
  return (
    <div>
      <p className="mb-3 text-xs text-muted">
        Команды выполняются в контейнере своего проекта. Проверки шагов и ответы ниже не засчитывают
        задачу.{' '}
        <InfoTip label="Подсказки к шагам">
          В первых задачах трека команды показаны сразу. В поздних шагах готовые команды открываются
          по одной. Доступ к подсказке не меняет прогресс; зачёт требует критериев приёмки и
          подтверждения. Команда помогает увидеть артефакт, который нужно сверить с признаком шага;
          наличие файла ещё не доказывает работу. Пустой git diff означает отсутствие
          незакоммиченных изменений: после коммита смотрите git show HEAD с тем же путём.
        </InfoTip>
      </p>
      <ol className="space-y-4">
        {task.steps?.map((text, i) => (
          <Step key={i} text={text} index={i} taskId={task.id} />
        ))}
      </ol>
      {labQuestions[task.id]?.map((q, i) => (
        <OutputQuestion key={i} question={q} />
      ))}
    </div>
  )
}
function Step({ text, index, taskId }: { text: string; index: number; taskId: string }) {
  const [revealed, setRevealed] = useState(0)
  const hints = commandHints(text)
  const hidden = !guidedLabTasks.includes(taskId) && index >= 2
  const check = labStepChecks[taskId]?.[index]
  const expected = check && hidden ? hideCommands(check.expected, hints, revealed) : check?.expected
  return (
    <li className="min-w-0">
      <div className="flex gap-3 text-sm leading-relaxed text-fg">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/12 text-xs font-semibold text-accent">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <InlineText text={hidden ? hideCommands(text, hints, revealed) : text} copyCode />
          {hidden && revealed < hints.length && (
            <div className="mt-2">
              <Button size="sm" onClick={() => setRevealed((n) => n + 1)}>
                Открыть подсказку {revealed + 1}/{hints.length}
              </Button>
            </div>
          )}
          {check && (
            <div className="mt-3 rounded-2xl border border-info/20 bg-info/[0.04] p-3 text-xs text-muted">
              <b className="block text-info">Проверка</b>
              <p className="my-2">{check.scope}</p>
              <CopyCommand cmd={check.command} inline />
              <p className="mt-2 leading-relaxed">{expected}</p>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}
function OutputQuestion({ question }: { question: LabQuestion }) {
  const [output, setOutput] = useState('')
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState('')
  return (
    <section className="mt-5 rounded-2xl border border-violet/20 bg-violet/[0.04] p-4">
      <Badge tone="violet">Самопроверка · без зачёта</Badge>
      <h4 className="mt-3 text-sm font-semibold text-fg">{question.prompt}</h4>
      {question.kind === 'output' ? (
        <>
          <label className="mt-3 block text-xs text-muted">
            Вывод вашего запуска
            <textarea
              className="field mt-1 min-h-24 font-mono text-xs"
              value={output}
              onChange={(e) => {
                setOutput(e.target.value)
                setResult('')
              }}
            />
          </label>
          <label className="mt-3 block text-xs text-muted">
            Ваш ответ ({question.unit})
            <input
              className="field mt-1"
              inputMode="decimal"
              value={answer}
              onChange={(e) => {
                setAnswer(e.target.value)
                setResult('')
              }}
            />
          </label>
          <Button
            className="mt-3"
            onClick={() => {
              const checked = checkOutput(question, output, answer)
              setResult(
                checked === 'missing'
                  ? 'Вставьте один результат с указанным полем и введите число.'
                  : checked === 'correct'
                    ? 'Ответ совпадает с вашим выводом. Это не автозачёт задачи.'
                    : 'Ответ не совпадает с числом в выводе: проверьте поле и единицы.',
              )
            }}
          >
            Сверить с выводом
          </Button>
        </>
      ) : (
        <div className="mt-3 space-y-2">
          {question.options.map((option, i) => (
            <Button
              key={option}
              className="w-full justify-start! whitespace-normal! text-left"
              onClick={() =>
                setResult(
                  (i === question.correct ? 'Верно. ' : 'Проверьте рассуждение. ') +
                    question.explanation,
                )
              }
            >
              {option}
            </Button>
          ))}
        </div>
      )}
      {result && (
        <p role="status" className="mt-3 text-xs text-muted">
          {result}
        </p>
      )}
    </section>
  )
}
