import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'
import { search } from './search'
import { createEmptyProgress } from './storage'

describe('search over program practice', () => {
  it('finds incidents, gyms and interview questions, but not by hints or debriefs', () => {
    const p = createEmptyProgress(curriculum)
    const kubeadm = search('kubeadm upgrade', curriculum, p).program
    expect(kubeadm.some((h) => h.kind === 'incident' && h.params.id === 'k8s-kubeadm-upgrade')).toBe(true)
    expect(search('helm', curriculum, p).program.some((h) => h.kind === 'gym' && h.params.id === 'gym-k8s-helm')).toBe(true)
    const triton = search('triton', curriculum, p).program.find((h) => h.kind === 'question')
    expect(triton?.params).toMatchObject({ view: 'topics' })
    // слово есть только в разборе инцидента k8s-certs — поиск не должен по нему находить
    const debriefOnly = curriculum.incidents.find((d) => d.id === 'k8s-certs')!.debrief.fix
    expect(debriefOnly).toContain('renew all')
    expect(search('renew all', curriculum, p).program.some((h) => h.params.id === 'k8s-certs')).toBe(false)
  })
})
