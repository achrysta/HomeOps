import { useEffect, useMemo, useReducer, useSyncExternalStore, type ReactNode } from 'react'
import { curriculum } from '../data'
import { DEFAULT_VACANCY_ID } from '../config/learning'
import {
  buildIndex,
  computeInterviewReadiness,
  computeSkillLevels,
  computeVacancyMatch,
  coreTasks,
  isLabTask,
  summarize,
} from '../lib/progress'
import { fetchIncidentReports, REPORTS_REFRESH_EVENT } from '../lib/labs'
import { getSaveFailed, loadProgress, saveProgress, subscribeSaveStatus } from '../lib/storage'
import { initSync, queueSave } from '../lib/sync'
import { StoreContext, type Store } from './context'
import { reducer } from './reducer'
import { refreshNow } from './useNow'

const idx = buildIndex(curriculum)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [progress, dispatch] = useReducer(reducer, curriculum, loadProgress)
  const saveError = useSyncExternalStore(subscribeSaveStatus, getSaveFailed)

  // Порядок важен: сначала прогресс попадает в очередь синхронизации, затем initSync сверяет его с файлом.
  useEffect(() => {
    saveProgress(progress)
    queueSave(progress)
    refreshNow()
  }, [progress])

  useEffect(() => {
    void initSync(curriculum, (remote) => dispatch({ type: 'replace', progress: remote }))
  }, [])

  // Отчёты автопроверки инцидентов приходят на сервер (verify.py → /api/incidents/reports) —
  // забираем новые, пока вкладка открыта. Первый раз — после первичной загрузки прогресса из файла.
  useEffect(() => {
    let stopped = false
    const pull = async () => {
      if (document.visibilityState !== 'visible') return
      const reports = await fetchIncidentReports(curriculum.incidents)
      if (!stopped && reports && Object.keys(reports).length) dispatch({ type: 'incident/reports', reports })
    }
    const first = setTimeout(() => void pull(), 2500)
    const timer = setInterval(() => void pull(), 10_000)
    const onDemand = () => void pull()
    window.addEventListener(REPORTS_REFRESH_EVENT, onDemand)
    document.addEventListener('visibilitychange', onDemand)
    return () => {
      stopped = true
      clearTimeout(first)
      clearInterval(timer)
      window.removeEventListener(REPORTS_REFRESH_EVENT, onDemand)
      document.removeEventListener('visibilitychange', onDemand)
    }
  }, [])

  const store = useMemo<Store>(() => {
    const vacancy =
      curriculum.vacancies.find((v) => v.id === progress.activeVacancyId) ??
      curriculum.vacancies.find((v) => v.id === DEFAULT_VACANCY_ID) ??
      curriculum.vacancies[0]
    const levels = computeSkillLevels(curriculum, progress)
    const core = coreTasks(curriculum, idx)
    return {
      curriculum,
      idx,
      progress,
      dispatch,
      vacancy,
      levels,
      match: computeVacancyMatch(vacancy, levels, idx),
      learning: summarize(core, progress),
      labs: summarize(core.filter(isLabTask), progress),
      tests: summarize(core.filter((t) => t.kind === 'quiz'), progress),
      interview: computeInterviewReadiness(curriculum, progress),
      saveError,
    }
  }, [progress, saveError])

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}
