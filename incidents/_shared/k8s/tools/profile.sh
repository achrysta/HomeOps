# Терминал Kubernetes-стенда: автодополнение, алиас k, namespace в приглашении
if [ -n "$BASH_VERSION" ]; then
  [ -f /usr/share/bash-completion/bash_completion ] && . /usr/share/bash-completion/bash_completion
  # Дополнение kubectl грузится лениво только для «kubectl» — для алиаса k подключаем сразу
  . /usr/share/bash-completion/completions/kubectl
  alias k=kubectl
  complete -o default -F __start_kubectl k
  __homeops_ns() { kubectl config view --minify -o jsonpath='{..namespace}' 2>/dev/null; }
  PS1='\[\e[36m\]k8s\[\e[0m\]:\[\e[33m\]$(__homeops_ns)\[\e[0m\] \w\$ '
fi
