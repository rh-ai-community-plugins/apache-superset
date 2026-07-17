# BFF (Backend For Frontend) Pattern

This document explains the BFF pattern as implemented in this plugin.

---

## What is the BFF Pattern?

The BFF (Backend For Frontend) pattern gives a plugin its own backend service. Instead of the frontend making direct K8s API calls through the dashboard's `/api/k8s/*` pass-through, it calls the plugin's own backend, which performs server-side logic and returns processed results.

### When to Use a BFF

- **Server-side aggregation** -- Combine multiple API calls into a single response (for example, checking Superset deployment status aggregates K8s Deployment readiness plus a live Superset health ping)
- **External service integration** -- Call third-party APIs using credentials stored server-side (API keys never reach the browser)
- **Complex business logic** -- Processing that would be too expensive or impractical in the browser
- **Data transformation** -- Heavy filtering, sorting, or enrichment before sending data to the frontend

### When NOT to Use a BFF

- Simple CRUD on K8s resources -- use the dashboard's `/api/k8s/*` pass-through instead
- Reading dashboard config or user info -- use `/api/status`, `/api/config`, etc.
- Anything the dashboard backend already provides (see `DASHBOARD_APIS.md`)

---

## How It Works

### Token Flow

```text
Browser                    Dashboard Backend              Plugin BFF              K8s API
  |                              |                            |                     |
  |-- fetch('/apache-superset/api/superset/status') ------------>|                     |
  |                              |                            |                     |
  |                    [matches proxyService path]             |                     |
  |                    [authorize: true]                       |                     |
  |                              |                            |                     |
  |                              |-- GET /api/superset/status                       |
  |                              |   Authorization: Bearer <user-token>             |
  |                              |--------------------------->|                     |
  |                              |                            |                     |
  |                              |                            |-- GET /apis/apps/...|
  |                              |                            |   Bearer <user-token>|
  |                              |                            |------------------->|
  |                              |                            |<-- deployment status|
  |                              |                            |                     |
  |                              |                            |-- GET /health (Superset)
  |                              |                            |------------------->|
  |                              |                            |<-- health response --|
  |                              |                            |                     |
  |                              |<-- aggregated response ----|                     |
  |<-- JSON response ------------|                            |                     |
```

Key points:

1. The frontend calls a path like `/apache-superset/api/superset/status` at the same origin
2. The dashboard backend matches this against `proxyService` entries in the federation ConfigMap
3. When `authorize: true`, the dashboard converts the user's `x-forwarded-access-token` into an `Authorization: Bearer <token>` header
4. The BFF receives the user's actual OpenShift token and uses it for K8s API calls -- all RBAC permissions are the user's own

### Dashboard Proxy Configuration

The dashboard discovers BFF services via the `proxyService` field in the federation ConfigMap:

```json
{
  "name": "apacheSuperset",
  "backend": {
    "remoteEntry": "/remoteEntry.js",
    "service": { "name": "apache-superset", "namespace": "apache-superset", "port": 8080 }
  },
  "proxyService": [{
    "path": "/apache-superset/api",
    "pathRewrite": "/api",
    "authorize": true,
    "tls": false,
    "service": { "name": "apache-superset-bff", "namespace": "apache-superset", "port": 3000 }
  }]
}
```

| Field | Purpose |
|---|---|
| `path` | URL prefix the dashboard intercepts |
| `pathRewrite` | Replacement prefix forwarded to the BFF |
| `authorize` | Forward the user's Bearer token |
| `service` | K8s Service name, namespace, and port for the BFF |

---

## This Plugin's BFF Implementation

### Directory Structure

```text
bff/
  package.json              # Express + TypeScript project
  tsconfig.json
  Containerfile             # UBI9 Node 22, runs on port 3000
  src/
    server.ts               # Express app with health check (Superset routes added per phase)
    types.ts                # Shared types (K8sMetadata, K8sResource, K8sList; Superset types added per phase)
    routes/
      superset/             # Superset-specific route handlers (added per phase)
        deploy.ts           # POST/DELETE /api/superset/deploy — lifecycle management
        status.ts           # GET  /api/superset/status       — health + readiness
        guestToken.ts       # GET  /api/superset/guest-token  — generate embed token
        dashboards.ts       # GET  /api/superset/dashboards   — list dashboards
    utils/
      k8sClient.ts          # Authenticated K8s API caller
  __tests__/
    k8sClient.test.ts
    superset/               # Superset route tests (added per phase)
```

### Endpoint: `GET /api/superset/status`

1. Extracts the Bearer token from the `Authorization` header
2. Checks the Superset `Deployment` readiness via the K8s API (RBAC-scoped to the user's namespace)
3. Pings the Superset `/health` endpoint to confirm the application layer is responding
4. Uses `Promise.allSettled` so a Superset health timeout doesn't mask the K8s readiness state
5. Returns an aggregated status object: `{ deployed, ready, url, version, mode }`

See `docs/architecture/SUPERSET_PLUGIN_ARCHITECTURE.md` for the full list of planned BFF endpoints and their request/response shapes.

### K8s Client

The `k8sClient.ts` utility makes authenticated requests to the K8s API server:

- **In-cluster**: Uses `KUBERNETES_SERVICE_HOST` and `KUBERNETES_SERVICE_PORT` env vars, reads the CA cert from the service account mount
- **Local dev**: Uses the `K8S_API_BASE` env var to point at the cluster API

The BFF always uses the user's forwarded token, never a service account token. This ensures all actions respect the user's RBAC permissions.

---

## Deployment

The BFF runs as a separate Deployment and Service in the Helm chart:

- **Deployment**: `apache-superset-bff` -- Node.js container on port 3000
- **Service**: `apache-superset-bff` -- ClusterIP service exposing port 3000

Both are gated by `.Values.bff.enabled` (default: `true`).

The BFF Service name in `values.yaml` must match the `proxyService.service.name` in the dashboard's federation ConfigMap.

---

## Local Development

The BFF runs as a separate Node.js process alongside the plugin dev server and the dashboard. See [LOCAL_SETUP.md](../development/LOCAL_SETUP.md) for full step-by-step instructions.

### Three-process setup

| Process | Port | What it does |
|---|---|---|
| Dashboard (container or source) | 8443 | Host app; proxies frontend and BFF requests |
| BFF service | 3000 | Plugin backend; makes K8s API calls server-side |
| Plugin dev server | 9500 | Plugin frontend; serves webpack bundles with HMR |

### Starting the BFF

```bash
cd bff
npm install                                              # first time only
K8S_API_BASE=$(oc whoami --show-server) npm run start:dev # must set K8S_API_BASE
```

**`K8S_API_BASE` is required.** When the BFF runs locally (not in-cluster), it doesn't have access to the `KUBERNETES_SERVICE_HOST` and `KUBERNETES_SERVICE_PORT` env vars that Kubernetes provides to pods. `K8S_API_BASE` tells the BFF where to find the cluster API server. Without it, all K8s API calls will fail and the endpoint returns 502.

### Dashboard proxy configuration

The dashboard must include a `proxyService` entry in `MODULE_FEDERATION_CONFIG` to route `/apache-superset/api/*` requests to the BFF:

```json
"proxyService": [{
  "path": "/apache-superset/api",
  "pathRewrite": "/api",
  "authorize": true,
  "tls": false,
  "localService": { "host": "localhost", "port": 3000 },
  "service": { "name": "placeholder", "namespace": "opendatahub", "port": 3000 }
}]
```

Without this entry, the dashboard won't proxy BFF requests and the frontend will receive HTML (the SPA fallback) instead of JSON.

### Standalone frontend development

The webpack dev server (`config/webpack.dev.js`) also has a proxy entry for `/apache-superset/api` that forwards to `localhost:3000`. This allows developing the frontend against the BFF without the full dashboard, but note that no user token will be forwarded in this mode.
