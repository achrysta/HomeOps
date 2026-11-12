# Инструменты Kubernetes-стендов: kubectl, kind, helm, etcdctl, редакторы и автопроверка.
# Один образ для рабочего места (терминал), verify/reset и служебного сервиса cluster
# (только cluster получает сокет Docker — он создаёт и удаляет узлы kind).
FROM python:3.12-alpine

ARG TARGETARCH
ARG KUBECTL_VERSION=v1.37.0
ARG KIND_VERSION=v0.33.0

# TARGETARCH задаёт BuildKit; старый сборщик его не передаёт — тогда берём архитектуру машины
RUN apk add --no-cache bash bash-completion curl jq bind-tools vim nano less docker-cli helm etcd-ctl \
 && ARCH="${TARGETARCH:-$(uname -m | sed -e 's/aarch64/arm64/' -e 's/x86_64/amd64/')}" \
 && curl -fsSLo /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${ARCH}/kubectl" \
 && echo "$(curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${ARCH}/kubectl.sha256")  /usr/local/bin/kubectl" | sha256sum -c - \
 && curl -fsSLo /usr/local/bin/kind "https://github.com/kubernetes-sigs/kind/releases/download/${KIND_VERSION}/kind-linux-${ARCH}" \
 && echo "$(curl -fsSL "https://github.com/kubernetes-sigs/kind/releases/download/${KIND_VERSION}/kind-linux-${ARCH}.sha256sum" | cut -d' ' -f1)  /usr/local/bin/kind" | sha256sum -c - \
 && chmod +x /usr/local/bin/kubectl /usr/local/bin/kind \
 && kubectl completion bash > /usr/share/bash-completion/completions/kubectl \
 && helm completion bash > /usr/share/bash-completion/completions/helm

COPY bin/ /usr/local/bin/
COPY profile.sh /etc/profile.d/zz-homeops-k8s.sh
RUN chmod +x /usr/local/bin/homeops-*

ENV PYTHONIOENCODING=utf-8 PYTHONDONTWRITEBYTECODE=1 KUBE_EDITOR=vim EDITOR=vim \
    KUBECONFIG=/root/.kube/config:/kube/config
WORKDIR /scenario
ENTRYPOINT ["homeops-kubeconfig"]
CMD ["bash", "-l"]
