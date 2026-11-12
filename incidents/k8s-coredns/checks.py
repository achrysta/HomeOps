"""Автопроверка инцидента k8s-coredns: DNS кластера и сервис заказов в namespace shop."""

from incident_kit import check, fail
from k8s_kit import deployment_status, get, pod_probe, probe_text, proxy_error, service_get, wait_deployment

NS = "shop"


@check("coredns", "CoreDNS работает", live=True)
def coredns():
    ok, msg = deployment_status("kube-system", "coredns")
    if not ok:
        fail(f"CoreDNS не готов: {msg}")
    return msg


@check("cluster-dns", "Имена сервисов кластера резолвятся", needs=["coredns"], live=True)
def cluster_dns():
    # из пода с обычной политикой DNS (ClusterFirst): так имена ищет любое приложение кластера
    r = pod_probe(NS, "app=db", "dns", "orders.shop.svc.cluster.local")
    if r["result"] != "ok":
        fail(f"Из пода db имя orders.shop.svc.cluster.local не резолвится: {probe_text(r)}.")
    return "orders.shop.svc.cluster.local резолвится из пода db"


@check("orders-dns", "Сервис заказов находит базу по имени", needs=["cluster-dns"], live=True)
def orders_dns():
    d = get("deployment", "orders", NS)
    if d is None:
        fail("Deployment orders не найден в namespace shop. Если удаляли — примените манифест заново.")
    spec = d["spec"]["template"]["spec"]
    if any("db" in (h.get("hostnames") or []) for h in spec.get("hostAliases") or []):
        fail("Имя db прописано в hostAliases вручную — так заказы обходят DNS кластера, а адрес в манифесте устареет, когда сервис или базу пересоздадут.")
    r = pod_probe(NS, "app=orders", "dns", "db")
    if r["result"] != "ok":
        fail(f"Из пода orders имя db не резолвится: {probe_text(r)}.")
    return "из пода orders имя db резолвится"


@check("orders", "Сервис заказов работает (2 из 2) и видит базу", needs=["orders-dns"], live=True)
def orders():
    ok, msg = wait_deployment(NS, "orders", timeout=90)
    if not ok:
        fail(msg)
    r = service_get(NS, "orders", 80, "/")
    if r.status != 200:
        fail(f"orders отвечает {proxy_error(r)}")
    return f"{msg}; {r.text.strip()[:80]}"
