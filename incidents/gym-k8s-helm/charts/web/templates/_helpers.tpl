{{- define "web.labels" -}}
app.kubernetes.io/name: web
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
