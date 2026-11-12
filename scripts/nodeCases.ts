import type { RegressionCase } from './incidentCases.ts'

/** Каждый сценарий nodeAccess получает свежий отдельный кластер. */
export const NODE_CASES: RegressionCase[] = [
  {
    "id": "k8s-node-notready",
    "nodeAccess": true,
    "stages": [
      {
        "id": "broken",
        "title": "Kubelet выключен, узел перестал посылать статус",
        "expected": {
          "node-ready": false,
          "workload": false,
          "logs": false,
          "stable": false,
          "autostart": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "bash",
              "-ec",
              "for i in $(seq 1 90); do status=$(kubectl get node homeops-regression-worker -o jsonpath='{.status.conditions[?(@.type==\"Ready\")].status}'); test \"$status\" != True && exit 0; sleep 1; done; exit 1"
            ]
          }
        ]
      },
      {
        "id": "partial",
        "title": "Конфигурация и запуск исправлены, автозапуска ещё нет",
        "expected": {
          "node-ready": true,
          "workload": true,
          "logs": true,
          "stable": true,
          "autostart": false
        },
        "commands": [
          {
            "service": "node",
            "node": "worker",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/--max-pods=two-hundred//' /etc/default/kubelet; sed -i 's@/etc/kubernetes/pki/ca.cert@/etc/kubernetes/pki/ca.crt@' /var/lib/kubelet/config.yaml; systemctl restart kubelet"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "wait",
              "--for=condition=Ready",
              "node/homeops-regression-worker",
              "--timeout=150s"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "node-ops",
              "rollout",
              "status",
              "deployment/orders",
              "--timeout=150s"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Kubelet включён в автозапуск",
        "expected": {
          "node-ready": true,
          "workload": true,
          "logs": true,
          "stable": true,
          "autostart": true
        },
        "commands": [
          {
            "service": "node",
            "node": "worker",
            "args": [
              "bash",
              "-ec",
              "systemctl enable kubelet"
            ]
          }
        ]
      },
      {
        "id": "bypass-ca",
        "title": "Обход: удалить клиентский CA вместо исправления пути",
        "expected": {
          "node-ready": true,
          "workload": true,
          "logs": false,
          "stable": true,
          "autostart": false
        },
        "commands": [
          {
            "service": "node",
            "node": "worker",
            "args": [
              "bash",
              "-ec",
              "sed -i '/clientCAFile:/d' /var/lib/kubelet/config.yaml; systemctl restart kubelet"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "wait",
              "--for=condition=Ready",
              "node/homeops-regression-worker",
              "--timeout=150s"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "k8s-control-plane",
    "nodeAccess": true,
    "stages": [
      {
        "id": "broken",
        "title": "Controller-manager падает, scheduler отсутствует",
        "expected": {
          "controller-manager": false,
          "scheduler": false,
          "release": false,
          "new-pod": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "bash",
              "-ec",
              "for i in $(seq 1 60); do status=$(kubectl -n kube-system get pods -l component=kube-controller-manager -o jsonpath='{.items[0].status.conditions[?(@.type==\"Ready\")].status}' 2>/dev/null || true); test \"$status\" != True && exit 0; sleep 1; done; exit 1"
            ]
          }
        ]
      },
      {
        "id": "partial",
        "title": "Controller-manager исправлен, планировщик ещё отсутствует",
        "expected": {
          "controller-manager": true,
          "scheduler": false,
          "release": false,
          "new-pod": false
        },
        "commands": [
          {
            "service": "node",
            "node": "control-plane",
            "args": [
              "bash",
              "-ec",
              "sed -i 's@controller-manager.cfg@controller-manager.conf@' /etc/kubernetes/manifests/kube-controller-manager.yaml; kubectl --kubeconfig /etc/kubernetes/admin.conf wait -n kube-system --for=condition=Ready pod -l component=kube-controller-manager --timeout=150s"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Манифест scheduler возвращён в staticPodPath",
        "expected": {
          "controller-manager": true,
          "scheduler": true,
          "release": true,
          "new-pod": true
        },
        "commands": [
          {
            "service": "node",
            "node": "control-plane",
            "args": [
              "bash",
              "-ec",
              "mv /root/maintenance/kube-scheduler.yaml /etc/kubernetes/manifests/kube-scheduler.yaml"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "bash",
              "-ec",
              "for i in $(seq 1 60); do kubectl -n kube-system wait --for=condition=Ready pod -l component=kube-scheduler --timeout=3s && break; sleep 2; done"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "release",
              "rollout",
              "status",
              "deployment/api",
              "--timeout=150s"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "k8s-coredns",
    "nodeAccess": true,
    "stages": [
      {
        "id": "broken",
        "title": "CoreDNS жив, зона неверна, orders использует Default",
        "expected": {
          "coredns": true,
          "cluster-dns": false,
          "orders-dns": false,
          "orders": false
        }
      },
      {
        "id": "partial",
        "title": "Зона cluster.local восстановлена, DNS policy приложения ещё неверна",
        "expected": {
          "coredns": true,
          "cluster-dns": true,
          "orders-dns": false,
          "orders": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "bash",
              "-ec",
              "kubectl -n kube-system get configmap coredns -o json > /tmp/coredns.json; python3 -c 'import json; p=json.load(open(\"/tmp/coredns.json\")); p[\"data\"][\"Corefile\"]=p[\"data\"][\"Corefile\"].replace(\"cluster.locl\",\"cluster.local\"); json.dump(p,open(\"/tmp/coredns-fixed.json\",\"w\"))'; kubectl replace -f /tmp/coredns-fixed.json; kubectl -n kube-system rollout restart deployment/coredns; kubectl -n kube-system rollout status deployment/coredns --timeout=120s"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "bash",
              "-ec",
              "for i in $(seq 1 30); do kubectl -n shop exec deployment/db -- python3 -c 'import socket; print(socket.getaddrinfo(\"orders.shop.svc.cluster.local\",None))' && exit 0; sleep 2; done; exit 1"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Orders использует DNS кластера",
        "expected": {
          "coredns": true,
          "cluster-dns": true,
          "orders-dns": true,
          "orders": true
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "shop",
              "patch",
              "deployment",
              "orders",
              "--type=merge",
              "-p",
              "{\"spec\":{\"template\":{\"spec\":{\"dnsPolicy\":\"ClusterFirst\"}}}}"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "shop",
              "rollout",
              "status",
              "deployment/orders",
              "--timeout=150s"
            ]
          }
        ]
      },
      {
        "id": "bypass-hosts",
        "title": "Обход: имя db прибито через hostAliases",
        "expected": {
          "coredns": true,
          "cluster-dns": true,
          "orders-dns": false,
          "orders": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "bash",
              "-ec",
              "ip=$(kubectl -n shop get service db -o jsonpath='{.spec.clusterIP}'); kubectl -n shop patch deployment orders --type=merge -p \"{\\\"spec\\\":{\\\"template\\\":{\\\"spec\\\":{\\\"hostAliases\\\":[{\\\"ip\\\":\\\"$ip\\\",\\\"hostnames\\\":[\\\"db\\\"]}]}}}}\"; kubectl -n shop rollout status deployment/orders --timeout=120s"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "k8s-certs",
    "nodeAccess": true,
    "stages": [
      {
        "id": "broken",
        "title": "Static API работает с просроченным клиентским сертификатом",
        "expected": {
          "workload": true,
          "apiserver": true,
          "logs": false,
          "exec": false
        }
      },
      {
        "id": "partial",
        "title": "Сертификат обновлён на диске, API держит старый в памяти",
        "expected": {
          "workload": true,
          "apiserver": true,
          "logs": false,
          "exec": false
        },
        "commands": [
          {
            "service": "node",
            "node": "control-plane",
            "args": [
              "bash",
              "-ec",
              "kubeadm certs renew apiserver-kubelet-client"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "API-сервер перезапущен и перечитал сертификат",
        "expected": {
          "workload": true,
          "apiserver": true,
          "logs": true,
          "exec": true
        },
        "commands": [
          {
            "service": "node",
            "node": "control-plane",
            "args": [
              "bash",
              "-ec",
              "crictl stop \"$(crictl ps --name kube-apiserver -q | head -n1)\"; for i in $(seq 1 60); do kubectl --kubeconfig /etc/kubernetes/admin.conf get --raw /readyz && exit 0; sleep 2; done; exit 1"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "k8s-etcd-restore",
    "nodeAccess": true,
    "stages": [
      {
        "id": "broken",
        "title": "Namespace payments удалён, API жив",
        "expected": {
          "api": true,
          "namespace": false,
          "config": false,
          "ledger": false
        }
      },
      {
        "id": "partial",
        "title": "Снапшот восстановлен в новый каталог, etcd ещё использует старый",
        "expected": {
          "api": true,
          "namespace": false,
          "config": false,
          "ledger": false
        },
        "commands": [
          {
            "service": "node",
            "node": "control-plane",
            "args": [
              "bash",
              "-ec",
              "snapshot=$(find /var/lib/etcd-backup -name '*.db' | head -n1); etcdutl snapshot restore \"$snapshot\" --data-dir /var/lib/etcd-restore --bump-revision 1000000000 --mark-compacted"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Etcd переключён на восстановленный каталог",
        "expected": {
          "api": true,
          "namespace": true,
          "config": true,
          "ledger": true
        },
        "commands": [
          {
            "service": "node",
            "node": "control-plane",
            "args": [
              "bash",
              "-ec",
              "sed -i 's@path: /var/lib/etcd$@path: /var/lib/etcd-restore@' /etc/kubernetes/manifests/etcd.yaml; sleep 20; for i in $(seq 1 60); do kubectl --kubeconfig /etc/kubernetes/admin.conf get --raw /readyz && break; sleep 2; done; kubectl --kubeconfig /etc/kubernetes/admin.conf -n payments rollout status deployment/ledger --timeout=150s"
            ]
          }
        ]
      },
      {
        "id": "bypass-recreate",
        "title": "Обход: создать объекты payments заново с новыми UID",
        "expected": {
          "api": true,
          "namespace": false,
          "config": false,
          "ledger": false
        },
        "commands": [
          {
            "service": "kubectl",
            "args": [
              "bash",
              "-ec",
              "kubectl -n payments get configmap ledger-config -o json > /tmp/ledger-cm.json; kubectl -n payments get deployment ledger -o json > /tmp/ledger-dep.json; python3 -c 'import json; items=[]; [(lambda p: (p.update(metadata={\"name\":p[\"metadata\"][\"name\"],\"namespace\":\"payments\"}),p.pop(\"status\",None),items.append(p)))(json.load(open(f))) for f in [\"/tmp/ledger-cm.json\",\"/tmp/ledger-dep.json\"]]; json.dump({\"apiVersion\":\"v1\",\"kind\":\"List\",\"items\":items},open(\"/tmp/recreated-ledger.json\",\"w\"))'; kubectl delete namespace payments --wait=true --timeout=120s; kubectl create namespace payments; kubectl apply -f /tmp/recreated-ledger.json; kubectl -n payments rollout status deployment/ledger --timeout=120s"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "k8s-kubeadm-upgrade",
    "nodeAccess": true,
    "requiredImages": [
      "homeops-k8s-upgrade:v1.37.1"
    ],
    "stages": [
      {
        "id": "broken",
        "title": "Кластер работает на v1.37.0",
        "expected": {
          "control-plane": false,
          "kubeadm": false,
          "kube-proxy": false,
          "kubelets": false,
          "schedulable": false,
          "workload": false
        }
      },
      {
        "id": "partial",
        "title": "Kubeadm обновил control plane, kubelet ещё старый",
        "expected": {
          "control-plane": true,
          "kubeadm": true,
          "kube-proxy": true,
          "kubelets": false,
          "schedulable": false,
          "workload": false
        },
        "commands": [
          {
            "service": "node",
            "node": "control-plane",
            "args": [
              "bash",
              "-ec",
              "install -m 755 /opt/k8s-v1.37.1/kubeadm /usr/bin/kubeadm; kubeadm upgrade apply v1.37.1 -y"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "kube-system",
              "rollout",
              "status",
              "daemonset/kube-proxy",
              "--timeout=150s"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "bash",
              "-ec",
              "for i in $(seq 1 60); do ready=$(kubectl -n kube-system get pods -l tier=control-plane -o json | python3 -c 'import json,sys; p=json.load(sys.stdin)[\"items\"]; print(sum(x[\"spec\"][\"containers\"][0][\"image\"].endswith(\":v1.37.1\") and any(c.get(\"type\")==\"Ready\" and c.get(\"status\")==\"True\" for c in x.get(\"status\",{}).get(\"conditions\",[])) for x in p))'); test \"$ready\" = 3 && exit 0; sleep 2; done; exit 1"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Kubelet обновлён на обоих узлах, worker снова принимает поды",
        "expected": {
          "control-plane": true,
          "kubeadm": true,
          "kube-proxy": true,
          "kubelets": true,
          "schedulable": true,
          "workload": true
        },
        "commands": [
          {
            "service": "node",
            "node": "control-plane",
            "args": [
              "bash",
              "-ec",
              "install -m 755 /opt/k8s-v1.37.1/kubelet /usr/bin/kubelet; install -m 755 /opt/k8s-v1.37.1/kubectl /usr/bin/kubectl; systemctl daemon-reload; systemctl restart kubelet"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "drain",
              "homeops-regression-worker",
              "--ignore-daemonsets",
              "--delete-emptydir-data",
              "--timeout=180s"
            ]
          },
          {
            "service": "node",
            "node": "worker",
            "args": [
              "bash",
              "-ec",
              "install -m 755 /opt/k8s-v1.37.1/kubeadm /usr/bin/kubeadm; kubeadm upgrade node; install -m 755 /opt/k8s-v1.37.1/kubelet /usr/bin/kubelet; install -m 755 /opt/k8s-v1.37.1/kubectl /usr/bin/kubectl; systemctl daemon-reload; systemctl restart kubelet"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "wait",
              "node",
              "--all",
              "--for=jsonpath={.status.nodeInfo.kubeletVersion}=v1.37.1",
              "--timeout=150s"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "uncordon",
              "homeops-regression-worker"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "kubectl",
              "-n",
              "upgrade-ops",
              "rollout",
              "status",
              "deployment/orders",
              "--timeout=150s"
            ]
          }
        ]
      },
      {
        "id": "bypass-tags",
        "title": "Обход на свежем кластере: новые теги static pods без kubeadm",
        "expected": {
          "control-plane": true,
          "kubeadm": false,
          "kube-proxy": false,
          "kubelets": false,
          "schedulable": false,
          "workload": false
        },
        "commands": [
          {
            "service": "node",
            "node": "control-plane",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/v1.37.0/v1.37.1/g' /etc/kubernetes/manifests/kube-apiserver.yaml /etc/kubernetes/manifests/kube-controller-manager.yaml /etc/kubernetes/manifests/kube-scheduler.yaml; for i in $(seq 1 60); do kubectl --kubeconfig /etc/kubernetes/admin.conf get --raw /readyz && break; sleep 2; done"
            ]
          },
          {
            "service": "kubectl",
            "args": [
              "bash",
              "-ec",
              "for i in $(seq 1 60); do ready=$(kubectl -n kube-system get pods -l tier=control-plane -o json | python3 -c 'import json,sys; p=json.load(sys.stdin)[\"items\"]; print(sum(x[\"spec\"][\"containers\"][0][\"image\"].endswith(\":v1.37.1\") and any(c.get(\"type\")==\"Ready\" and c.get(\"status\")==\"True\" for c in x.get(\"status\",{}).get(\"conditions\",[])) for x in p))'); test \"$ready\" = 3 && exit 0; sleep 2; done; exit 1"
            ]
          }
        ],
        "resetStand": true
      }
    ]
  }
]
