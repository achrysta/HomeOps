# Бинарники Kubernetes следующей версии для стенда kubeadm upgrade (вместо apt-репозитория, которого в kind нет).
# Образ загружается в узлы kind вместе с остальными (images.txt), стенд копирует бинарники из него внутри узла.
# Сборка скачивает файлы с dl.k8s.io — нужна сеть (один раз на машину). Собирает homeops-cluster prepare
# (docker build --build-arg TARGETARCH=<arch> upgrade); права на запуск выставляет скрипт узла при копировании.
FROM scratch
ARG TARGETARCH
ARG K8S_VERSION=v1.37.1
ADD https://dl.k8s.io/release/${K8S_VERSION}/bin/linux/${TARGETARCH}/kubeadm /upgrade/kubeadm
ADD https://dl.k8s.io/release/${K8S_VERSION}/bin/linux/${TARGETARCH}/kubelet /upgrade/kubelet
ADD https://dl.k8s.io/release/${K8S_VERSION}/bin/linux/${TARGETARCH}/kubectl /upgrade/kubectl
