import type { RegressionCase } from './incidentCases.ts'

export const NAMESPACE_CASES: RegressionCase[] = [
  {
    "id": "k8s-nodeport",
    "stages": [
      {
        "id": "broken",
        "title": "NodePort есть, targetPort не совпадает",
        "expected": {
          "service": true,
          "endpoints": false,
          "some-node": false,
          "all-nodes": false,
          "no-host": true
        }
      },
      {
        "id": "partial",
        "title": "targetPort исправлен, Local ещё оставляет control plane без ответа",
        "expected": {
          "service": true,
          "endpoints": true,
          "some-node": true,
          "all-nodes": false,
          "no-host": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "partners",
              "patch",
              "service",
              "partner-api",
              "--type=merge",
              "-p",
              "{\"spec\":{\"ports\":[{\"port\":80,\"targetPort\":\"http\",\"nodePort\":30080}]}}"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "partners",
              "rollout",
              "status",
              "deployment/partner-api",
              "--timeout=150s"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Cluster направляет трафик на каждый узел",
        "expected": {
          "service": true,
          "endpoints": true,
          "some-node": true,
          "all-nodes": true,
          "no-host": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "partners",
              "patch",
              "service",
              "partner-api",
              "--type=merge",
              "-p",
              "{\"spec\":{\"externalTrafficPolicy\":\"Cluster\"}}"
            ]
          }
        ]
      },
      {
        "id": "bypass-port",
        "title": "Обход: поменять установленный партнёру порт",
        "expected": {
          "service": false,
          "endpoints": false,
          "some-node": false,
          "all-nodes": false,
          "no-host": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "partners",
              "patch",
              "service",
              "partner-api",
              "--type=merge",
              "-p",
              "{\"spec\":{\"ports\":[{\"port\":80,\"targetPort\":\"http\",\"nodePort\":30081}]}}"
            ]
          }
        ]
      },
      {
        "id": "bypass-host",
        "title": "Обход: порт вернуть, открыть hostPort",
        "expected": {
          "service": true,
          "endpoints": true,
          "some-node": true,
          "all-nodes": true,
          "no-host": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "partners",
              "patch",
              "service",
              "partner-api",
              "--type=merge",
              "-p",
              "{\"spec\":{\"ports\":[{\"port\":80,\"targetPort\":\"http\",\"nodePort\":30080}]}}"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "partners",
              "patch",
              "deployment",
              "partner-api",
              "--type=strategic",
              "-p",
              "{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"name\":\"api\",\"ports\":[{\"containerPort\":8080,\"name\":\"http\",\"hostPort\":30888}]}]}}}}"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "k8s-kustomize",
    "stages": [
      {
        "id": "broken",
        "title": "Опечатка в имени patch, base не менялся",
        "expected": {
          "build": false,
          "base": true,
          "applied": false,
          "replicas": false,
          "config": false
        }
      },
      {
        "id": "partial",
        "title": "Overlay собирается и выкачен, ключ LOG_LEVEL ещё неверный",
        "expected": {
          "build": true,
          "base": true,
          "applied": true,
          "replicas": true,
          "config": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "apply",
              "-k",
              "app/overlays/prod"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "orders-prod",
              "rollout",
              "status",
              "deployment/orders-api",
              "--timeout=150s"
            ]
          }
        ],
        "edits": [
          {
            "path": "app/overlays/prod/replicas.yaml",
            "from": "name: order-api",
            "to": "name: orders-api"
          }
        ]
      },
      {
        "id": "fixed",
        "title": "LOG_LEVEL приходит из исправленного prod overlay",
        "expected": {
          "build": true,
          "base": true,
          "applied": true,
          "replicas": true,
          "config": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "apply",
              "-k",
              "app/overlays/prod"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "orders-prod",
              "rollout",
              "status",
              "deployment/orders-api",
              "--timeout=150s"
            ]
          }
        ],
        "edits": [
          {
            "path": "app/overlays/prod/kustomization.yaml",
            "from": "LOG-LEVEL=info",
            "to": "LOG_LEVEL=info"
          }
        ]
      },
      {
        "id": "bypass-base",
        "title": "Обход: изменить общий base",
        "expected": {
          "build": true,
          "base": false,
          "applied": true,
          "replicas": true,
          "config": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "bash",
              "-ec",
              "printf '\\n# regression bypass\\n' >> app/base/deployment.yaml"
            ]
          }
        ]
      },
      {
        "id": "bypass-direct",
        "title": "Обход: base вернуть, добавить env прямо в кластер",
        "expected": {
          "build": true,
          "base": true,
          "applied": false,
          "replicas": false,
          "config": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "bash",
              "-ec",
              "sed -i '/# regression bypass/d' app/base/deployment.yaml; sed -i '${/^$/d;}' app/base/deployment.yaml"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "orders-prod",
              "set",
              "env",
              "deployment/orders-api",
              "LOG_LEVEL=info"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "k8s-secret",
    "stages": [
      {
        "id": "broken",
        "title": "Двойной base64 и пароль в debug ConfigMap",
        "expected": {
          "db-password": true,
          "secret": false,
          "from-secret": true,
          "api": false,
          "no-plaintext": false
        }
      },
      {
        "id": "partial",
        "title": "Secret исправлен, пароль всё ещё открыт в ConfigMap",
        "expected": {
          "db-password": true,
          "secret": true,
          "from-secret": true,
          "api": true,
          "no-plaintext": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "payments",
              "patch",
              "secret",
              "payments-db",
              "--type=merge",
              "-p",
              "{\"stringData\":{\"password\":\"Ledger-2026-q4\"}}"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "payments",
              "rollout",
              "restart",
              "deployment/payments-api"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "payments",
              "rollout",
              "status",
              "deployment/payments-api",
              "--timeout=150s"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Пароль удалён из ConfigMap",
        "expected": {
          "db-password": true,
          "secret": true,
          "from-secret": true,
          "api": true,
          "no-plaintext": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "payments",
              "delete",
              "configmap",
              "payments-debug"
            ]
          }
        ]
      },
      {
        "id": "bypass-db",
        "title": "Обход: поменять общий пароль базы",
        "expected": {
          "db-password": false,
          "secret": true,
          "from-secret": true,
          "api": true,
          "no-plaintext": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "payments",
              "patch",
              "secret",
              "ledger-db-auth",
              "--type=merge",
              "-p",
              "{\"stringData\":{\"password\":\"Changed-by-bypass\"}}"
            ]
          }
        ]
      },
      {
        "id": "bypass-plain",
        "title": "Обход: пароль базы вернуть, вписать пароль в Deployment",
        "expected": {
          "db-password": true,
          "secret": true,
          "from-secret": false,
          "api": false,
          "no-plaintext": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "payments",
              "patch",
              "secret",
              "ledger-db-auth",
              "--type=merge",
              "-p",
              "{\"stringData\":{\"password\":\"Ledger-2026-q4\"}}"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "payments",
              "patch",
              "deployment",
              "payments-api",
              "--type=strategic",
              "-p",
              "{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"name\":\"api\",\"env\":[{\"name\":\"DB_PASSWORD\",\"valueFrom\":null,\"value\":\"Ledger-2026-q4\"}]}]}}}}"
            ]
          }
        ]
      },
      {
        "id": "bypass-configmap",
        "title": "Обход: Secret вернуть, оставить утечку в ConfigMap",
        "expected": {
          "db-password": true,
          "secret": true,
          "from-secret": true,
          "api": true,
          "no-plaintext": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "payments",
              "patch",
              "deployment",
              "payments-api",
              "--type=strategic",
              "-p",
              "{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"name\":\"api\",\"env\":[{\"name\":\"DB_PASSWORD\",\"value\":null,\"valueFrom\":{\"secretKeyRef\":{\"name\":\"payments-db\",\"key\":\"password\"}}}]}]}}}}"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "payments",
              "rollout",
              "status",
              "deployment/payments-api",
              "--timeout=150s"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "payments",
              "create",
              "configmap",
              "payments-debug",
              "--from-literal=DB_PASSWORD=Ledger-2026-q4"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "k8s-pending",
    "stages": [
      {
        "id": "broken",
        "title": "Requests, StorageClass и квота мешают разным компонентам",
        "expected": {
          "api": false,
          "renderer": false,
          "worker": false,
          "quota": true
        }
      },
      {
        "id": "partial",
        "title": "API помещается на узел, PVC и batch ещё сломаны",
        "expected": {
          "api": true,
          "renderer": false,
          "worker": false,
          "quota": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "reports",
              "patch",
              "deployment",
              "report-api",
              "--type=strategic",
              "-p",
              "{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"name\":\"api\",\"resources\":{\"requests\":{\"cpu\":\"100m\",\"memory\":\"128Mi\"}}}]}}}}"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "reports",
              "rollout",
              "status",
              "deployment/report-api",
              "--timeout=150s"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "PVC с существующим классом и ресурсы batch в квоте",
        "expected": {
          "api": true,
          "renderer": true,
          "worker": true,
          "quota": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "reports",
              "delete",
              "pvc",
              "renderer-cache"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "bash",
              "-ec",
              "kubectl -n reports create -f - <<'YAML'\napiVersion: v1\nkind: PersistentVolumeClaim\nmetadata: {name: renderer-cache, namespace: reports}\nspec:\n  storageClassName: standard\n  accessModes: [ReadWriteOnce]\n  resources: {requests: {storage: 1Gi}}\nYAML"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "reports-batch",
              "patch",
              "deployment",
              "report-worker",
              "--type=strategic",
              "-p",
              "{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"name\":\"worker\",\"resources\":{\"requests\":{\"cpu\":\"100m\",\"memory\":\"128Mi\"},\"limits\":{\"memory\":\"256Mi\"}}}]}}}}"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "reports",
              "rollout",
              "status",
              "deployment/report-renderer",
              "--timeout=150s"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "reports-batch",
              "rollout",
              "status",
              "deployment/report-worker",
              "--timeout=150s"
            ]
          }
        ]
      },
      {
        "id": "bypass-quota",
        "title": "Обход: убрать квоту платформы",
        "expected": {
          "api": true,
          "renderer": true,
          "worker": true,
          "quota": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "reports-batch",
              "delete",
              "resourcequota",
              "batch-quota"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "k8s-rollout",
    "stages": [
      {
        "id": "broken",
        "title": "Неверный образ выкатки и небезопасная стратегия",
        "expected": {
          "serving": false,
          "safe-rollout": false
        }
      },
      {
        "id": "partial",
        "title": "Рабочий образ возвращён, плохая выкатка ещё теряет все реплики",
        "expected": {
          "serving": true,
          "safe-rollout": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "checkout",
              "rollout",
              "undo",
              "deployment/checkout"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "checkout",
              "rollout",
              "status",
              "deployment/checkout",
              "--timeout=150s"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Неудачный релиз оставляет работающие поды",
        "expected": {
          "serving": true,
          "safe-rollout": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "checkout",
              "patch",
              "deployment",
              "checkout",
              "--type=merge",
              "-p",
              "{\"spec\":{\"strategy\":{\"type\":\"RollingUpdate\",\"rollingUpdate\":{\"maxUnavailable\":0,\"maxSurge\":1}}}}"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "k8s-hpa-pdb",
    "stages": [
      {
        "id": "broken",
        "title": "Metrics API нет, PDB запрещает вытеснение",
        "expected": {
          "metrics": false,
          "hpa": false,
          "pdb": false,
          "scale": false
        }
      },
      {
        "id": "partial",
        "title": "Metrics API установлен, requests и PDB ещё неверны",
        "expected": {
          "metrics": true,
          "hpa": false,
          "pdb": false,
          "scale": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "bash",
              "-ec",
              "helm install metrics-server charts/metrics-server-3.14.0.tgz -n kube-system --set \"args={--kubelet-insecure-tls}\"; kubectl -n kube-system rollout status deployment/metrics-server --timeout=150s; for i in $(seq 1 30); do kubectl top pods -n search && exit 0; sleep 3; done; exit 1"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "HPA считает CPU и масштабирует, PDB разрешает одно вытеснение",
        "expected": {
          "metrics": true,
          "hpa": true,
          "pdb": true,
          "scale": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "search",
              "patch",
              "deployment",
              "search-api",
              "--type=strategic",
              "-p",
              "{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"name\":\"search\",\"resources\":{\"requests\":{\"cpu\":\"100m\",\"memory\":\"64Mi\"},\"limits\":{\"memory\":\"128Mi\"}}}]}}}}"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "search",
              "patch",
              "pdb",
              "search-api",
              "--type=merge",
              "-p",
              "{\"spec\":{\"minAvailable\":null,\"maxUnavailable\":1}}"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "search",
              "rollout",
              "status",
              "deployment/search-api",
              "--timeout=150s"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "k8s-netpol",
    "stages": [
      {
        "id": "broken",
        "title": "DNS и маршрут к embedder закрыты",
        "expected": {
          "dns": false,
          "search": false,
          "embedder-closed": false,
          "egress-closed": false,
          "default-deny": true
        }
      },
      {
        "id": "partial",
        "title": "DNS разрешён, политики embedder ещё неверны",
        "expected": {
          "dns": true,
          "search": false,
          "embedder-closed": false,
          "egress-closed": false,
          "default-deny": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "rag",
              "patch",
              "networkpolicy",
              "search-api-egress",
              "--type=merge",
              "-p",
              "{\"spec\":{\"egress\":[{\"to\":[{\"namespaceSelector\":{\"matchLabels\":{\"name\":\"embeddings\"}},\"podSelector\":{\"matchLabels\":{\"app\":\"embedder\"}}}],\"ports\":[{\"port\":8080}]},{\"to\":[{\"namespaceSelector\":{\"matchLabels\":{\"kubernetes.io/metadata.name\":\"kube-system\"}},\"podSelector\":{\"matchLabels\":{\"k8s-app\":\"kube-dns\"}}}],\"ports\":[{\"port\":53,\"protocol\":\"UDP\"},{\"port\":53,\"protocol\":\"TCP\"}]}]}}"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Только search-api к embedder и DNS",
        "expected": {
          "dns": true,
          "search": true,
          "embedder-closed": true,
          "egress-closed": true,
          "default-deny": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "rag",
              "patch",
              "networkpolicy",
              "search-api-egress",
              "--type=merge",
              "-p",
              "{\"spec\":{\"egress\":[{\"to\":[{\"namespaceSelector\":{\"matchLabels\":{\"kubernetes.io/metadata.name\":\"embeddings\"}},\"podSelector\":{\"matchLabels\":{\"app\":\"embedder\"}}}],\"ports\":[{\"port\":8080}]},{\"to\":[{\"namespaceSelector\":{\"matchLabels\":{\"kubernetes.io/metadata.name\":\"kube-system\"}},\"podSelector\":{\"matchLabels\":{\"k8s-app\":\"kube-dns\"}}}],\"ports\":[{\"port\":53,\"protocol\":\"UDP\"},{\"port\":53,\"protocol\":\"TCP\"}]}]}}"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "embeddings",
              "patch",
              "networkpolicy",
              "allow-search-api",
              "--type=merge",
              "-p",
              "{\"spec\":{\"ingress\":[{\"from\":[{\"namespaceSelector\":{\"matchLabels\":{\"kubernetes.io/metadata.name\":\"rag\"}},\"podSelector\":{\"matchLabels\":{\"app\":\"search-api\"}}}],\"ports\":[{\"port\":8080}]}]}}"
            ]
          }
        ]
      },
      {
        "id": "bypass-deny",
        "title": "Обход: удалить default-deny платформы",
        "expected": {
          "dns": true,
          "search": true,
          "embedder-closed": true,
          "egress-closed": true,
          "default-deny": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "rag",
              "delete",
              "networkpolicy",
              "default-deny"
            ]
          }
        ]
      },
      {
        "id": "bypass-egress",
        "title": "Обход: default-deny вернуть, весь egress открыть другой политикой",
        "expected": {
          "dns": true,
          "search": true,
          "embedder-closed": true,
          "egress-closed": false,
          "default-deny": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "apply",
              "-f",
              ".setup/platform.yaml"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "rag",
              "patch",
              "networkpolicy",
              "search-api-egress",
              "--type=merge",
              "-p",
              "{\"spec\":{\"egress\":[{}]}}"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "k8s-rbac",
    "stages": [
      {
        "id": "broken",
        "title": "Агент под default, группа Role неверна, namespace restricted",
        "expected": {
          "sync": false,
          "rollout": false,
          "least-privilege": false,
          "pod-security": true
        }
      },
      {
        "id": "partial",
        "title": "Агент и Role исправлены, новая версия server не проходит Pod Security",
        "expected": {
          "sync": true,
          "rollout": false,
          "least-privilege": true,
          "pod-security": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "models",
              "patch",
              "role",
              "model-sync",
              "--type=merge",
              "-p",
              "{\"rules\":[{\"apiGroups\":[\"\"],\"resources\":[\"configmaps\"],\"verbs\":[\"get\"]},{\"apiGroups\":[\"apps\"],\"resources\":[\"deployments\"],\"verbs\":[\"get\",\"patch\"]}]}"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "models",
              "patch",
              "deployment",
              "model-sync",
              "--type=strategic",
              "-p",
              "{\"spec\":{\"template\":{\"spec\":{\"securityContext\":{\"runAsNonRoot\":true,\"runAsUser\":1000,\"seccompProfile\":{\"type\":\"RuntimeDefault\"}},\"containers\":[{\"name\":\"sync\",\"securityContext\":{\"allowPrivilegeEscalation\":false,\"capabilities\":{\"drop\":[\"ALL\"]}}}],\"serviceAccountName\":\"model-sync\"}}}}"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "models",
              "rollout",
              "status",
              "deployment/model-sync",
              "--timeout=150s"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Оба шаблона соответствуют restricted",
        "expected": {
          "sync": true,
          "rollout": true,
          "least-privilege": true,
          "pod-security": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "models",
              "patch",
              "deployment",
              "model-server",
              "--type=strategic",
              "-p",
              "{\"spec\":{\"template\":{\"spec\":{\"securityContext\":{\"runAsNonRoot\":true,\"runAsUser\":1000,\"seccompProfile\":{\"type\":\"RuntimeDefault\"}},\"containers\":[{\"name\":\"server\",\"securityContext\":{\"allowPrivilegeEscalation\":false,\"capabilities\":{\"drop\":[\"ALL\"]}}}]}}}}"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "models",
              "rollout",
              "status",
              "deployment/model-server",
              "--timeout=150s"
            ]
          }
        ]
      },
      {
        "id": "bypass-admin",
        "title": "Обход: выдать агенту cluster-admin",
        "expected": {
          "sync": true,
          "rollout": true,
          "least-privilege": false,
          "pod-security": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "create",
              "clusterrolebinding",
              "regression-model-sync-admin",
              "--clusterrole=cluster-admin",
              "--serviceaccount=models:model-sync"
            ]
          }
        ]
      },
      {
        "id": "bypass-security",
        "title": "Обход: лишние права убрать, профиль namespace ослабить",
        "expected": {
          "sync": true,
          "rollout": true,
          "least-privilege": true,
          "pod-security": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "delete",
              "clusterrolebinding",
              "regression-model-sync-admin"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "label",
              "namespace",
              "models",
              "pod-security.kubernetes.io/enforce=privileged",
              "--overwrite"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "k8s-storage",
    "stages": [
      {
        "id": "broken",
        "title": "RWX не поддерживается провизионером",
        "expected": {
          "pvc": false,
          "ready": false,
          "persist": false,
          "retain": false
        }
      },
      {
        "id": "partial",
        "title": "RWO выделил том, приложение пишет в другой каталог",
        "expected": {
          "pvc": true,
          "ready": true,
          "persist": false,
          "retain": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "vectors",
              "delete",
              "statefulset",
              "vectordb"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "vectors",
              "delete",
              "pvc",
              "index-vectordb-0"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "apply",
              "-f",
              "manifests/vectordb.yaml"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "vectors",
              "rollout",
              "status",
              "statefulset/vectordb",
              "--timeout=150s"
            ]
          }
        ],
        "edits": [
          {
            "path": "manifests/vectordb.yaml",
            "from": "ReadWriteMany",
            "to": "ReadWriteOnce"
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Данные на томе, Retain сохраняет его при удалении PVC",
        "expected": {
          "pvc": true,
          "ready": true,
          "persist": true,
          "retain": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "apply",
              "-f",
              "manifests/vectordb.yaml"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "vectors",
              "rollout",
              "status",
              "statefulset/vectordb",
              "--timeout=150s"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "bash",
              "-ec",
              "pv=$(kubectl -n vectors get pvc index-vectordb-0 -o jsonpath='{.spec.volumeName}'); kubectl patch pv \"$pv\" --type=merge -p '{\"spec\":{\"persistentVolumeReclaimPolicy\":\"Retain\"}}'"
            ]
          }
        ],
        "edits": [
          {
            "path": "manifests/vectordb.yaml",
            "from": "mountPath: /data",
            "to": "mountPath: /var/lib/vectordb"
          }
        ]
      },
      {
        "id": "bypass-deployment",
        "title": "Обход: заменить StatefulSet на Deployment",
        "expected": {
          "pvc": false,
          "ready": false,
          "persist": false,
          "retain": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "bash",
              "-ec",
              "kubectl -n vectors get statefulset vectordb -o json > /tmp/vectordb.json; python3 -c 'import json; p=json.load(open(\"/tmp/vectordb.json\")); p[\"kind\"]=\"Deployment\"; p[\"metadata\"]={\"name\":\"vectordb\",\"namespace\":\"vectors\"}; p[\"spec\"]={k:p[\"spec\"][k] for k in [\"replicas\",\"selector\",\"template\"]}; p[\"spec\"][\"template\"][\"spec\"][\"volumes\"].append({\"name\":\"index\",\"persistentVolumeClaim\":{\"claimName\":\"index-vectordb-0\"}}); p.pop(\"status\",None); json.dump(p,open(\"/tmp/vectordb-deployment.json\",\"w\"))'; kubectl -n vectors delete statefulset vectordb --cascade=orphan; kubectl apply -f /tmp/vectordb-deployment.json"
            ]
          }
        ]
      }
    ]
  }
]

