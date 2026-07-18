# Deploying the Plugin on OpenShift

This guide walks through deploying the plugin on an OpenShift cluster that already has the Red Hat OpenShift AI (RHOAI) Dashboard running.

## Prerequisites

- **Helm** — to install the plugin chart
- **`oc` CLI** — logged in to the target OpenShift cluster
- **Access to `redhat-ods-applications`** — typically requires cluster-admin, since you need to modify the dashboard's Deployment

> **ODH vs RHOAI:** This guide uses the RHOAI dashboard namespace `redhat-ods-applications` and deployment name `rhods-dashboard`. If you are running the Open Data Hub (ODH) upstream distribution instead, substitute `opendatahub` for the namespace and `odh-dashboard` for the deployment name throughout.

---

## 1. Install the Plugin

Install directly from the OCI registry — no need to clone the repo:

```bash
helm install apache-superset oci://quay.io/OWNER/apache-superset-chart \
  --version 0.1.0 \
  --namespace apache-superset \
  --create-namespace
```

Or, from a local checkout of the repository:

```bash
helm install apache-superset chart/ \
  --namespace apache-superset \
  --create-namespace
```

This creates:

- A **Deployment** and **Service** (`apache-superset`) serving the plugin's static assets (including `remoteEntry.js`) via Nginx on port 8080
- A **BFF Deployment** and **Service** (`apache-superset-bff`) running the plugin's backend service on port 3000 (enabled by default)

### Overriding Defaults

Pass `--set` flags to customize the installation:

```bash
helm install apache-superset oci://quay.io/OWNER/apache-superset-chart \
  --version 0.1.0 \
  --namespace apache-superset \
  --create-namespace \
  --set replicaCount=2
```

To deploy the frontend only (no BFF):

```bash
helm install apache-superset oci://quay.io/OWNER/apache-superset-chart \
  --version 0.1.0 \
  --namespace apache-superset \
  --create-namespace \
  --set bff.enabled=false
```

See [Helm Chart Reference](#helm-chart-reference) for the full list of configurable values.

---

## 2. Register with the RHOAI Dashboard

The dashboard discovers plugins through the `MODULE_FEDERATION_CONFIG` environment variable on its Deployment. You need to append this plugin's entry to that configuration.

### Frontend Only

If you deployed without the BFF (or want to register the frontend first), use this configuration:

```bash
oc get configmap federation-config \
  -n redhat-ods-applications \
  -o jsonpath='{.data.module-federation-config\.json}' \
| python3 -c "
import json, sys
config = json.load(sys.stdin)
config.append({
  'name': 'apacheSuperset',
  'backend': {
    'remoteEntry': '/remoteEntry.js',
    'authorize': False,
    'tls': False,
    'service': {
      'name': 'apache-superset',
      'namespace': 'apache-superset',
      'port': 8080
    }
  }
})
print(json.dumps(config))
" > /tmp/mf-config-extended.json

oc set env deployment/rhods-dashboard \
  -n redhat-ods-applications \
  "MODULE_FEDERATION_CONFIG=$(cat /tmp/mf-config-extended.json)"
```

### Frontend + BFF

If you deployed with the BFF enabled, add a `proxyService` entry so the dashboard proxies API requests to the BFF service:

```bash
oc get configmap federation-config \
  -n redhat-ods-applications \
  -o jsonpath='{.data.module-federation-config\.json}' \
| python3 -c "
import json, sys
config = json.load(sys.stdin)
config.append({
  'name': 'apacheSuperset',
  'backend': {
    'remoteEntry': '/remoteEntry.js',
    'authorize': False,
    'tls': False,
    'service': {
      'name': 'apache-superset',
      'namespace': 'apache-superset',
      'port': 8080
    }
  },
  'proxyService': [{
    'path': '/apache-superset/api',
    'pathRewrite': '/api',
    'authorize': True,
    'tls': False,
    'service': {
      'name': 'apache-superset-bff',
      'namespace': 'apache-superset',
      'port': 3000
    }
  }]
})
print(json.dumps(config))
" > /tmp/mf-config-extended.json

oc set env deployment/rhods-dashboard \
  -n redhat-ods-applications \
  "MODULE_FEDERATION_CONFIG=$(cat /tmp/mf-config-extended.json)"
```

The `proxyService` entry tells the dashboard to forward requests from `/apache-superset/api/*` to the BFF service, rewriting the path to `/api/*` and forwarding the user's Bearer token (`authorize: true`).

### Why `MODULE_FEDERATION_CONFIG` Instead of the ConfigMap?

The RHOAI operator reconciles the `federation-config` ConfigMap, which means direct edits to it may be reverted. Setting the environment variable on the Deployment overrides the ConfigMap value and survives operator reconciliation.

New dashboard pods roll out automatically after the environment variable is set. After roughly two minutes, reload the RHOAI Dashboard in your browser to see the plugin's sidebar entries.

---

## 3. Deploying a Superset Instance

Once the plugin is installed and registered, users can deploy Superset instances on-demand through the plugin's **Instance Management** page in the RHOAI Dashboard UI. The BFF handles deployment by rendering Helm-templated K8s manifests and applying them to the target namespace.

### What Gets Deployed

When a user deploys Superset into their namespace, the BFF creates the following resources:

| Resource | Name | Purpose |
|---|---|---|
| Deployment | `superset-superset` | Superset application server (Gunicorn on port 8088) |
| Deployment | `superset-superset-postgres` | PostgreSQL metadata database |
| Service | `superset-superset-svc` | Superset ClusterIP service |
| Service | `superset-superset-postgres-svc` | PostgreSQL ClusterIP service |
| ConfigMap | `superset-superset-config` | `superset_config.py` configuration |
| Secret | `superset-superset-secret` | Admin credentials, secret key, DB password |
| PVC | `superset-superset-postgres-pv` | PostgreSQL data persistence (5Gi default) |
| ServiceAccount | `superset-superset-sa` | Pod security identity |
| Route (optional) | `superset-superset-route` | External access via OpenShift Route |

All resources are labelled with `app.kubernetes.io/part-of=superset` and `app.kubernetes.io/instance=superset` for lifecycle management.

### RBAC Requirements

Users who deploy Superset instances need the following namespace-scoped permissions:

```yaml
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["create", "get", "list", "update", "delete"]
- apiGroups: [""]
  resources: ["services", "configmaps", "secrets", "persistentvolumeclaims", "serviceaccounts"]
  verbs: ["create", "get", "list", "update", "delete"]
- apiGroups: ["route.openshift.io"]
  resources: ["routes"]
  verbs: ["create", "get", "list", "update", "delete"]
```

The plugin's Instance Management page checks permissions via `SelfSubjectAccessReview` and disables the Deploy button if the user lacks sufficient access.

### Security Notes

- **Credentials are auto-generated**: The BFF generates random admin passwords, secret keys, and PostgreSQL passwords at deploy time if not provided. These are stored in K8s Secrets in the target namespace.
- **No admin credentials in env vars**: The BFF reads Superset admin credentials from K8s Secrets at request time, not from environment variables.
- **Guest token bridge**: Dashboard embedding uses scoped guest tokens that carry the RHOAI user's identity. The frontend never handles admin credentials.

---

## 4. Verify

### Check registration

Confirm the plugin appears in the dashboard's federation config:

```bash
oc set env deployment/rhods-dashboard -n redhat-ods-applications --list \
  | grep MODULE_FEDERATION_CONFIG \
  | python3 -c "
import json, sys
data = json.loads(sys.stdin.read().split('=', 1)[1])
for entry in data:
    name = entry['name']
    has_proxy = bool(entry.get('proxyService'))
    print(f'  {name}' + (' (+ BFF proxy)' if has_proxy else ''))
"
```

### Check pods

Verify the plugin pods are running:

```bash
oc get pods -n apache-superset
```

You should see pods for `apache-superset` (and `apache-superset-bff` if BFF is enabled), all in `Running` status.

### Check the dashboard

Open the RHOAI Dashboard in your browser. You should see the plugin's pages in the sidebar under **Community Plugins > Apache Superset**.

---

## Uninstalling

### 1. Tear down Superset instances

Before uninstalling the plugin, tear down any running Superset instances through the plugin's Instance Management page, or manually:

```bash
oc delete deployment,service,configmap,secret,pvc,serviceaccount,route \
  -l app.kubernetes.io/part-of=superset \
  -n <target-namespace>
```

### 2. Remove from the dashboard federation config

Retrieve the current config, remove the `apacheSuperset` entry, and re-apply:

```bash
oc get configmap federation-config \
  -n redhat-ods-applications \
  -o jsonpath='{.data.module-federation-config\.json}' \
| python3 -c "
import json, sys
config = json.load(sys.stdin)
config = [e for e in config if e.get('name') != 'apacheSuperset']
print(json.dumps(config))
" > /tmp/mf-config-reduced.json

oc set env deployment/rhods-dashboard \
  -n redhat-ods-applications \
  "MODULE_FEDERATION_CONFIG=$(cat /tmp/mf-config-reduced.json)"
```

### 3. Uninstall the Helm release

```bash
helm uninstall apache-superset -n apache-superset
oc delete namespace apache-superset   # optional: remove the namespace entirely
```

---

## Helm Chart Reference

### Frontend Values

| Parameter | Default | Description |
|---|---|---|
| `image.repository` | `quay.io/OWNER/apache-superset` | Frontend container image |
| `image.tag` | `""` (defaults to appVersion) | Frontend image tag |
| `image.pullPolicy` | `IfNotPresent` | Image pull policy |
| `replicaCount` | `1` | Frontend replicas |
| `service.type` | `ClusterIP` | Frontend Service type |
| `service.port` | `8080` | Frontend Service port |
| `resources.requests.cpu` | `50m` | Frontend CPU request |
| `resources.requests.memory` | `64Mi` | Frontend memory request |
| `resources.limits.cpu` | `100m` | Frontend CPU limit |
| `resources.limits.memory` | `128Mi` | Frontend memory limit |

### BFF Values

| Parameter | Default | Description |
|---|---|---|
| `bff.enabled` | `true` | Deploy the BFF service |
| `bff.image.repository` | `quay.io/OWNER/apache-superset-bff` | BFF container image |
| `bff.image.tag` | `""` (defaults to appVersion) | BFF image tag |
| `bff.chartDir` | `/opt/app-root/src/chart-templates/superset` | Path to Superset Helm sub-chart templates inside the BFF container |
| `bff.service.port` | `3000` | BFF Service port |
| `bff.resources.requests.cpu` | `100m` | BFF CPU request |
| `bff.resources.requests.memory` | `128Mi` | BFF memory request |
| `bff.resources.limits.cpu` | `200m` | BFF CPU limit |
| `bff.resources.limits.memory` | `256Mi` | BFF memory limit |

### Superset Sub-Chart Values

These values configure the on-demand Superset instances deployed by the BFF. Set `superset.enabled=true` only if you want to pre-deploy a Superset instance via Helm (the normal flow is on-demand deployment through the UI).

| Parameter | Default | Description |
|---|---|---|
| `superset.enabled` | `false` | Pre-deploy Superset via Helm (normally deployed on-demand via UI) |
| `superset.image.repository` | `quay.io/OWNER/apache-superset-server` | Superset container image |
| `superset.image.tag` | `""` (defaults to appVersion) | Superset image tag |
| `superset.port` | `8088` | Superset application port |
| `superset.admin.username` | `admin` | Superset admin username |
| `superset.admin.password` | `""` (auto-generated if empty) | Superset admin password |
| `superset.admin.email` | `admin@superset.local` | Admin email address |
| `superset.embedding.enabled` | `true` | Enable embedded dashboard mode |
| `superset.embedding.guestTokenJwtSecret` | `""` (auto-generated if empty) | JWT secret for guest tokens |
| `superset.embedding.guestTokenExpSeconds` | `300` | Guest token expiration (seconds) |
| `superset.embedding.allowedOrigins` | `""` | Allowed CORS origins for embedding |
| `superset.secretKey` | `""` (auto-generated if empty) | Superset `SECRET_KEY` |
| `superset.resources.requests.cpu` | `500m` | Superset CPU request |
| `superset.resources.requests.memory` | `512Mi` | Superset memory request |
| `superset.resources.limits.cpu` | `1` | Superset CPU limit |
| `superset.resources.limits.memory` | `1Gi` | Superset memory limit |
| `superset.postgres.image.repository` | `registry.redhat.io/rhel9/postgresql-16` | PostgreSQL image |
| `superset.postgres.password` | `""` (auto-generated if empty) | PostgreSQL password (alphanumeric only) |
| `superset.postgres.database` | `superset` | Database name |
| `superset.postgres.user` | `superset` | Database user |
| `superset.postgres.persistence.size` | `5Gi` | PVC size for PostgreSQL data |
| `superset.postgres.persistence.storageClass` | `""` (cluster default) | Storage class for PVC |
| `superset.route.enabled` | `false` | Create an OpenShift Route for direct Superset access |
| `superset.route.host` | `""` (auto-generated) | Route hostname |

For the complete list, see [`chart/values.yaml`](../../chart/values.yaml).
