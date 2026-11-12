# Зал начинается с пустого namespace gym-helm; локальный чарт — /scenario/charts/web (репозиториев в стенде нет).
# Ответы — в /answers рабочего места, папка очищается при каждой подготовке.
set -e
mkdir -p /answers
rm -f /answers/*
echo "Namespace gym-helm пуст, чарт — /scenario/charts/web"
