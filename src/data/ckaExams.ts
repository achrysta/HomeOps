/** Варианты 1–8 неизменны: на их id и состав ссылается история попыток. */
export const CKA_EXAM_VARIANTS = [
  { id: 'cka-1', title: 'Вариант 1', incidentIds: ['k8s-crashloop', 'k8s-nodeport', 'k8s-kustomize', 'k8s-pending', 'k8s-probes'] },
  { id: 'cka-2', title: 'Вариант 2', incidentIds: ['k8s-service-endpoints', 'k8s-secret', 'k8s-kustomize', 'k8s-storage', 'k8s-rollout'] },
  { id: 'cka-3', title: 'Вариант 3', incidentIds: ['k8s-hpa-pdb', 'k8s-nodeport', 'k8s-secret', 'k8s-pending', 'k8s-crashloop'] },
  { id: 'cka-4', title: 'Вариант 4', incidentIds: ['k8s-rbac', 'k8s-nodeport', 'k8s-rollout', 'k8s-pending', 'k8s-crashloop'] },
  { id: 'cka-5', title: 'Вариант 5', incidentIds: ['k8s-netpol', 'k8s-kustomize', 'k8s-pending', 'k8s-secret', 'k8s-crashloop'] },
  { id: 'cka-6', title: 'Вариант 6', incidentIds: ['k8s-rbac', 'k8s-service-endpoints', 'k8s-pending', 'k8s-rollout', 'k8s-crashloop'] },
  { id: 'cka-7', title: 'Вариант 7', incidentIds: ['k8s-operator', 'k8s-statefulset', 'k8s-nodeport', 'k8s-pending', 'k8s-crashloop'] },
  { id: 'cka-8', title: 'Вариант 8', incidentIds: ['k8s-gateway', 'k8s-operator', 'k8s-probes', 'k8s-storage', 'k8s-rollout'] },
  { id: 'cka-9', title: 'Вариант 9 · Финал', incidentIds: ['k8s-storm', 'k8s-operator', 'k8s-storage'] },
] as const
