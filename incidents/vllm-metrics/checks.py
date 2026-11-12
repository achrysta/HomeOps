"""Проверки инцидента vllm-metrics: сбор метрик, recording rule для TTFT и алерт на очередь."""

from incident_kit import STATE, check, fail, finalizer, get, log, post, prom_max, wait_for

PROM = "http://prometheus:9090"
VLLM = "http://vllm:8000"
RULE = "job:vllm_ttft_seconds:p95"
ALERT = "VLLMQueueBacklog"


def set_load(level: str) -> None:
    r = post(f"{VLLM}/admin/load", {"level": level}, timeout=5)
    if r.status != 200:
        fail(f"Не удалось переключить нагрузку на {level}: HTTP {r.status}")


def target_health() -> str | None:
    data = get(f"{PROM}/api/v1/targets?state=active").json()
    for t in data.get("data", {}).get("activeTargets", []):
        if t.get("labels", {}).get("job") == "vllm":
            return t.get("health")
    return None


def alert_state() -> str:
    data = get(f"{PROM}/api/v1/alerts").json()
    states = [a.get("state") for a in data.get("data", {}).get("alerts", []) if a.get("labels", {}).get("alertname") == ALERT]
    if "firing" in states:
        return "firing"
    return "pending" if "pending" in states else "inactive"


@check("scrape", "Prometheus собирает метрики vLLM")
def scrape():
    health = wait_for(lambda: target_health() == "up" and "up", timeout=20, interval=2)
    if not health:
        current = target_health()
        if current is None:
            fail('В Prometheus нет target с job="vllm".')
        fail(f'Target job="vllm" в состоянии {current}: метрики модели не собираются.')
    waiting = prom_max(PROM, "vllm:num_requests_waiting")
    if waiting is None:
        fail("Target в состоянии up, но метрики vllm:num_requests_waiting в Prometheus нет.")
    return f"Target vllm в состоянии up, текущая очередь: {waiting:.0f}."


@check("rules", "Recording rule и алерт загружены и вычисляются без ошибок")
def rules():
    data = get(f"{PROM}/api/v1/rules").json()
    found = {}
    for g in data.get("data", {}).get("groups", []):
        for r in g.get("rules", []):
            found[r.get("name")] = r
    for name in (RULE, ALERT):
        if name not in found:
            fail(f"Правило {name} не загружено. Имена правил менять нельзя: на них завязаны панель и маршрутизация алертов.")
        if found[name].get("health") not in ("ok", "unknown"):
            fail(f"Правило {name} вычисляется с ошибкой: {found[name].get('lastError') or found[name].get('health')}.")
    return f"Загружены {RULE} и {ALERT}."


@check("ttft", "Панель TTFT p95 показывает реальную картину: < 0.8 с в норме, > 1.5 с при перегрузке", needs=["scrape", "rules"])
def ttft():
    set_load("normal")
    if not wait_for(lambda: prom_max(PROM, RULE) is not None, timeout=30, interval=3):
        fail(f"Серия {RULE} пустая: панель TTFT ничего не покажет.")
    log("обычная нагрузка: ждём, пока TTFT p95 и алерт придут в норму")
    normal = wait_for(lambda: (v := prom_max(PROM, RULE)) is not None and v < 0.8 and alert_state() == "inactive" and v, timeout=120, interval=3,
                      progress="ждём нормальных значений")
    value = prom_max(PROM, RULE)
    STATE["alert_in_normal"] = alert_state()
    if value is None:
        fail(f"Серия {RULE} пропала во время проверки.")
    if not normal:
        fail(f"В обычной нагрузке {RULE} = {value:.2f} с (ожидается < 0.8 с: реальный TTFT p95 около 0.35 с).")
    set_load("overload")
    log("включена перегрузка: ждём роста TTFT p95")
    high = wait_for(lambda: (v := prom_max(PROM, RULE)) is not None and v > 1.5 and v, timeout=120, interval=3, progress="ждём реакции панели")
    if not high:
        value = prom_max(PROM, RULE)
        fail(f"Через 2 минуты перегрузки {RULE} = {value if value is None else round(value, 2)} с: панель не отражает рост TTFT (реальный p95 — 3–4 с).")
    return f"В норме p95 = {normal:.2f} с, при перегрузке — {high:.2f} с."


@check("alert", f"Алерт {ALERT} срабатывает при очереди > 20 дольше 30 с и молчит в норме", needs=["scrape", "rules"])
def alert():
    if STATE.get("alert_in_normal") not in (None, "inactive"):
        fail(f"Алерт в состоянии {STATE['alert_in_normal']} при обычной нагрузке (очередь 0–2 запроса).")
    if "alert_in_normal" not in STATE:
        set_load("normal")
        if not wait_for(lambda: alert_state() == "inactive", timeout=90, interval=3):
            fail(f"Алерт не гаснет при обычной нагрузке: состояние {alert_state()}.")
    set_load("overload")
    log("перегрузка: ждём перехода алерта в firing")
    fired = wait_for(lambda: alert_state() == "firing", timeout=100, interval=3, progress="ждём алерт")
    if not fired:
        waiting = prom_max(PROM, "vllm:num_requests_waiting")
        fail(f"Очередь из {waiting if waiting is None else round(waiting)} запросов держится больше полутора минут, а алерт в состоянии {alert_state()}.")
    return "При перегрузке алерт перешёл в firing, в норме был неактивен."


@finalizer
def restore():
    post(f"{VLLM}/admin/load", {"level": "normal"}, timeout=5)
