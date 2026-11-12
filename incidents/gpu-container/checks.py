"""Реальный CUDA/vLLM-стенд. Ни один путь не принимает CPU fallback за решение."""
from incident_kit import check
import checks_common as common


@check("visible", "В контейнере виден NVIDIA GPU через NVML", live=True)
def visible():
    return common.visible()


@check("gpu", "CUDA-операция выполняется на GPU контейнера", live=True)
def gpu():
    return common.gpu()


@check("ready", "Модель загружена и ready", needs=["gpu"], live=True)
def ready():
    return common.ready()


@check("request", "Gateway возвращает сгенерированный ответ", needs=["ready"])
def request():
    return common.inference()


@check("constraints", "База и ограничения условия сохранены", live=True)
def constraints():
    return common.constraints()
