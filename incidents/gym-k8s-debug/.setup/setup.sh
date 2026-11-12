# Поды для разбора и чистая папка ответов /answers в рабочем месте (ответы пишутся в терминале зала)
set -e
mkdir -p /answers
rm -f /answers/*
kubectl apply -f .setup/pods.yaml
