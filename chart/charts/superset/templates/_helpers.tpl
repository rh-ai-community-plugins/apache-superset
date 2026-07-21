{{/*
Expand the name of the sub-chart.
*/}}
{{- define "superset.name" -}}
superset
{{- end }}

{{/*
Fully qualified name — scoped to the release.
Capped at 41 characters so that appending the longest compound suffix
("-postgres-svc", 13 chars) always stays within the Kubernetes 63-char
limit AND the "-postgres" discriminator is never silently stripped by the
trunc 50 in superset.postgres.fullname (41 + 9 = 50 exactly).
*/}}
{{- define "superset.fullname" -}}
{{- printf "%s-superset" .Release.Name | trunc 41 | trimSuffix "-" }}
{{- end }}

{{/*
Chart label value.
*/}}
{{- define "superset.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "superset.labels" -}}
helm.sh/chart: {{ include "superset.chart" . }}
{{ include "superset.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: superset
{{- end }}

{{/*
Selector labels for the Superset web app.
*/}}
{{- define "superset.selectorLabels" -}}
app.kubernetes.io/name: {{ include "superset.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service account name.
*/}}
{{- define "superset.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (printf "%s-sa" (include "superset.fullname" .)) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
PostgreSQL fullname.
*/}}
{{- define "superset.postgres.fullname" -}}
{{- printf "%s-postgres" (include "superset.fullname" .) | trunc 50 | trimSuffix "-" }}
{{- end }}

{{/*
PostgreSQL selector labels.
*/}}
{{- define "superset.postgres.selectorLabels" -}}
app.kubernetes.io/name: {{ include "superset.name" . }}-postgres
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
PostgreSQL labels.
*/}}
{{- define "superset.postgres.labels" -}}
helm.sh/chart: {{ include "superset.chart" . }}
{{ include "superset.postgres.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: superset
app.kubernetes.io/component: database
{{- end }}

{{/*
PostgreSQL connection URI.
*/}}
{{- define "superset.postgres.uri" -}}
{{- printf "postgresql+psycopg2://%s:%s@%s-svc:5432/%s" .Values.postgres.user (required "postgres.password is required" .Values.postgres.password) (include "superset.postgres.fullname" .) .Values.postgres.database }}
{{- end }}
