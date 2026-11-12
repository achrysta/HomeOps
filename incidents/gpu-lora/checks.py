"""Реальный CUDA/vLLM-стенд. Ни один путь не принимает CPU fallback за решение."""
from incident_kit import check
import checks_common as common


@check("gpu", "CUDA-операция выполняется на GPU контейнера", live=True)
def gpu():
    return common.gpu()


@check("rank", "Runtime поддерживает rank адаптера", live=True)
def rank():
    return common.rank()


@check("ready", "Модель загружена и ready", needs=["gpu"], live=True)
def ready():
    return common.ready()


@check("adapter", "Совместимый LoRA-адаптер обслуживает запрос", needs=["ready"])
def adapter():
    return common.adapter()


@check("constraints", "База и ограничения условия сохранены", live=True)
def constraints():
    return common.constraints()
