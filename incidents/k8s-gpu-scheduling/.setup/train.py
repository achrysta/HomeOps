"""Ночное обучение: держит GPU и раз в 10 секунд пишет прогресс."""
import time

epoch = 0
print("обучение ranker-v7: GPU захвачен", flush=True)
while True:
    epoch += 1
    print(f"эпоха {epoch}: loss {1 / (1 + epoch * 0.05):.4f}", flush=True)
    time.sleep(10)
