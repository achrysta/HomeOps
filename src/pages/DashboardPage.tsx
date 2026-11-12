import { ShieldAlert } from 'lucide-react'
import { MatchOriginBar } from '../components/MatchOriginBar'
import { TodayPlan } from '../components/TodayPlan'
import { Card, InfoTip, PageHeader, Ring } from '../components/ui'
import { TODAY_WINDOW_DAYS } from '../config/weights'
import { pct, targetName } from '../lib/labels'
import { coreTasks, getTaskProgress, getVerification, matchOrigin, nextActions } from '../lib/progress'
import { recentPractice, todayReviews } from '../lib/today'
import { useStore } from '../state/context'
import { buildHash } from '../state/router'
import { useNow } from '../state/useNow'

/** «Сегодня»: план дня слева, путь к роли, повторения и неделя — справа. */
export function DashboardPage() {
  const { curriculum, idx, progress, vacancy, levels, match, learning } = useStore()
  const now = useNow()
  const next = nextActions(curriculum, idx, progress, vacancy, levels, 1)[0]
  const reviews = todayReviews(curriculum, progress, now)
  const week = recentPractice(curriculum, progress, now)
  const complete = coreTasks(curriculum, idx).every((task) => getVerification(task, getTaskProgress(progress, task.id)) === 'verified')
  const date = new Date(now).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div>
      <PageHeader eyebrow={`${date} · ${targetName(vacancy)}`} title="Сегодня" />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <TodayPlan next={next} complete={complete} />

        <aside className="min-w-0 space-y-5">
          <Card
            title="Прогресс"
            action={
              <a className="shrink-0 text-xs text-accent hover:underline" href={buildHash('vacancy')}>
                Подробнее →
              </a>
            }
          >
            <a href={buildHash('vacancy')} className="flex items-center gap-4 rounded-lg hover:bg-surface-2/50">
              <Ring value={match.overall} label={`Покрытие профиля ${pct(match.overall)}`}>
                <span className="text-base font-semibold tabular-nums">{pct(match.overall)}</span>
              </Ring>
              <span className="min-w-0 text-sm">
                <span className="block font-semibold text-fg">Навыки профиля</span>
                <span className="block text-xs text-muted">
                  обязательные {pct(match.categories.required.pct)} · важные {pct(match.categories.important.pct)}
                </span>
              </span>
            </a>
            <div className="mt-3">
              <MatchOriginBar origin={matchOrigin(match)} compact />
            </div>
            <a href={buildHash('roadmap')} className="mt-5 block rounded-lg hover:bg-surface-2/50">
              <span className="block text-sm font-semibold text-fg">Основная программа</span>
              <span className="mt-1 block text-sm text-muted tabular-nums">
                Засчитано {learning.verified} из {learning.taskCount + learning.envSkipped}
              </span>
            </a>
            {learning.completedUnverified > 0 && (
              <a className="mt-4 flex items-start gap-1.5 text-xs text-warn hover:underline" href={buildHash('labs', { kind: 'practice', status: 'completed' })}>
                <ShieldAlert size={13} className="mt-0.5 shrink-0" /> Отмечено «Выполнено», но не засчитано: {learning.completedUnverified}
              </a>
            )}
          </Card>

          <Card title="Повторения" subtitle="Срок повторения уже наступил">
            <div className="grid grid-cols-2 gap-3">
              <a href={buildHash('trainer', { mode: reviews.practice ? 'due' : 'smart', scope: 'all' })} className="rounded-xl bg-surface-2 p-3.5 hover:ring-1 hover:ring-accent/40">
                <div className={`text-2xl font-semibold tabular-nums ${reviews.practice ? 'text-warn' : 'text-fg'}`}>{reviews.practice}</div>
                <div className="mt-0.5 text-xs text-muted">тренажёр</div>
              </a>
              <a href={buildHash('interview', { view: reviews.interview ? 'review' : 'topics' })} className="rounded-xl bg-surface-2 p-3.5 hover:ring-1 hover:ring-violet/40">
                <div className={`text-2xl font-semibold tabular-nums ${reviews.interview ? 'text-warn' : 'text-fg'}`}>{reviews.interview}</div>
                <div className="mt-0.5 text-xs text-muted">своими словами</div>
              </a>
            </div>
            {reviews.gyms > 0 && (
              <a href={buildHash('gyms')} className="mt-3 block text-xs text-muted hover:text-accent">
                Залов пора пройти: {reviews.gyms} →
              </a>
            )}
          </Card>

          <Card
            title={`За ${TODAY_WINDOW_DAYS} дней`}
            action={
              <InfoTip label="Как считается неделя">
                Подтверждения — только у засчитанных практических задач. Тест и вопрос считаются один раз, даже если повторялись. Инцидент — по первому успешному отчёту автопроверки.
              </InfoTip>
            }
          >
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              {[
                { label: 'подтверждений', value: week.evidence, href: buildHash('labs', { kind: 'practice', status: 'completed' }) },
                { label: 'тестов сдано', value: week.quizzes, href: buildHash('tests') },
                { label: 'инцидентов решено', value: week.incidents, href: buildHash('incidents') },
                { label: 'вопросов отработано', value: week.questions, href: buildHash('trainer') },
              ].map((item) => (
                // подпись в разметке первой (dt → dd), а на экране число крупно сверху
                <div key={item.label} className="flex min-w-0 flex-col-reverse">
                  <dt className="text-xs text-muted">{item.label}</dt>
                  <dd>
                    <a href={item.href} aria-label={`${item.label}: ${item.value}`} className="text-2xl font-semibold tabular-nums text-fg hover:text-accent">
                      {item.value}
                    </a>
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  )
}
