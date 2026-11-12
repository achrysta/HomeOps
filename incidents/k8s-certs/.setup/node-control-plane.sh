# Поломка сертификатов (выполняется внутри узла homeops-control-plane: homeops-cluster prepare k8s-certs).
# Кластер «прожил год»: клиентский сертификат, с которым API-сервер ходит к kubelet,
# просрочен — тот же CA и ключ, но срок действия закончился позавчера.
set -e
cd /etc/kubernetes/pki
openssl req -new -key apiserver-kubelet-client.key -subj "/CN=kube-apiserver-kubelet-client" -out /tmp/k.csr 2>/dev/null
printf 'extendedKeyUsage=clientAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\n' > /tmp/k.ext
openssl x509 -req -in /tmp/k.csr -CA ca.crt -CAkey ca.key -extfile /tmp/k.ext \
  -not_before "$(date -u -d '-367 days' +%Y%m%d%H%M%SZ)" -not_after "$(date -u -d '-2 days' +%Y%m%d%H%M%SZ)" \
  -out apiserver-kubelet-client.crt 2>/dev/null
rm -f /tmp/k.csr /tmp/k.ext
# API-сервер читает сертификаты только при старте — перезапускаем его контейнер, kubelet поднимет static pod заново
crictl stop "$(crictl ps --name kube-apiserver -q)" >/dev/null
sleep 5
until kubectl --kubeconfig /etc/kubernetes/admin.conf get --raw /readyz >/dev/null 2>&1; do sleep 2; done
echo "сертификаты control plane подготовлены"
