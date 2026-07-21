# Apache Superset RHOAI Dashboard Plugin — Architecture Document

## Table of Contents

1. [Overview](#1-overview)
2. [Apache Superset Summary](#2-apache-superset-summary)
3. [Licensing](#3-licensing)
4. [Deployment Architecture](#4-deployment-architecture)
5. [Embedding Architecture](#5-embedding-architecture)
6. [Authentication & Authorization](#6-authentication--authorization)
7. [Plugin Frontend](#7-plugin-frontend)
8. [BFF Service](#8-bff-service)
9. [Helm Chart Design](#9-helm-chart-design)
10. [OpenShift Compatibility](#10-openshift-compatibility)
11. [Configuration Reference](#11-configuration-reference)
12. [Development Setup](#12-development-setup)
13. [Risks & Mitigations](#13-risks--mitigations)
14. [Alternative Tools Considered](#14-alternative-tools-considered)

---

## 1. Overview

This document describes the architecture for an RHOAI Dashboard community plugin that:

1. **Deploys Apache Superset on-demand** into a user's OpenShift project
2. **Embeds Superset dashboards** inline within the RHOAI Dashboard UI using the official React Embedded SDK
3. **Bridges authentication** so the RHOAI Dashboard user's identity is passed through to Superset via guest tokens

The plugin follows the same patterns established by the `hello-world` reference plugin: Module Federation for frontend integration, a BFF (Backend-for-Frontend) Express.js service for server-side logic, and Helm chart packaging for deployment.

### Why Superset?

Superset was selected after a feasibility analysis of five BI/analytics tools (n8n, Metabase, Superset, Lightdash, Redash). It won on every dimension that matters:

| Criterion | Superset | Runner-up |
|---|---|---|
| License | **Apache 2.0** (fully permissive) | Redash (BSD-2) |
| Embedding in OSS | **Yes** — React SDK, no badge, no paywall | Redash (iframe-only) |
| React SDK | **Yes** (`@superset-ui/embedded-sdk`) | None of the others |
| Official Helm chart | **Yes** (in-repo, maintained by Apache) | None (all community) |
| Lightweight mode | **Yes** (no Redis/Celery for basic use) | Metabase (H2 mode) |
| Project governance | **Apache Foundation** | Metabase (corporate) |

---

## 2. Apache Superset Summary

- **Repository**: <https://github.com/apache/superset>
- **License**: Apache License 2.0
- **Language**: Python (Flask/Gunicorn backend) + TypeScript/React frontend
- **Container image**: `apache/superset` on Docker Hub
- **Default port**: 8088
- **Documentation**: <https://superset.apache.org/>

### Components

| Component | Purpose | Required? |
|---|---|---|
| **Superset web app** (Gunicorn) | Main UI, API server, embedded dashboard serving | Yes |
| **PostgreSQL** | Metadata database (users, dashboards, charts, datasets) | Yes |
| **Redis** | Cache + Celery message broker | No (in-memory cache fallback) |
| **Celery Worker** | Async SQL queries, report generation, thumbnails | No (sync queries work) |
| **Celery Beat** | Scheduled tasks, alerts, cache warming | No |

### Lightweight Mode (Recommended for Plugin)

Superset can run **without Redis and Celery**:

- Use `SimpleCache` (in-memory) or database-backed caching instead of Redis
- Synchronous query execution still works — users lose async queries, scheduled reports, and alerts
- This reduces deployment from 5 pods to **2 pods** (Superset + PostgreSQL)

### REST API

Superset exposes a comprehensive REST API at `/api/v1/` with OpenAPI/Swagger documentation:

| Category | Capabilities |
|---|---|
| Dashboards | Full CRUD, import/export, embedding config, bulk operations |
| Charts | Full CRUD, data querying |
| Datasets | CRUD, column/metric management |
| Databases | Connection management, test connectivity |
| Security | Login, CSRF tokens, guest token generation |
| Import/Export | Full asset migration |

API authentication: session cookies or `Authorization: Bearer <token>` from `/api/v1/security/login`.

---

## 3. Licensing

### Apache License 2.0

- **Commercial use**: Fully permitted
- **Modification**: Permitted (must note changes in modified files)
- **Distribution**: Permitted (include license copy, retain notices)
- **Embedding**: No restrictions
- **Patent grant**: Explicit patent grant from contributors
- **Copyleft**: None — permissive license, no viral provisions

### Red Hat Ecosystem Compatibility

- Apache 2.0 is fully compatible with Red Hat's distribution practices
- Red Hat already distributes many Apache 2.0 projects
- The plugin would deploy the upstream container image, not redistribute modified source
- The plugin's own code would be under the community plugins license (typically Apache 2.0)
- **No legal review needed** — this is the most straightforward licensing scenario possible

### Commercial Offering

[Preset](https://preset.io) is the commercial managed cloud service built on Superset (founded by Superset's creators). It adds SaaS features (AI Assist, SOC 2/HIPAA) but these are not proprietary extensions to the open-source code. All embedding features are in the OSS version.

---

## 4. Deployment Architecture

### High-Level Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│  RHOAI Dashboard (host application)                              │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Superset Plugin (Module Federation)                       │  │
│  │                                                            │  │
│  │  Pages:                                                    │  │
│  │   - Instance Management  — deploy / status / teardown      │  │
│  │   - Embedded Dashboards  — browse & view dashboards inline │  │
│  │                                                            │  │
│  │  Remote Modules:                                           │  │
│  │   - ./extensions  (nav items, routes, area)                │  │
│  │   - ./Icon        (nav icon)                               │  │
│  └──────────┬─────────────────────────────────────────────────┘  │
│             │                                                     │
│  ┌──────────▼─────────────────────────────────────────────────┐  │
│  │  BFF Service (Express.js)                                  │  │
│  │   Port 3000 | Proxied via dashboard at /apache-superset/api│  │
│  │                                                            │  │
│  │  Endpoints:                                                │  │
│  │   POST   /api/superset/deploy      — create K8s resources  │  │
│  │   DELETE /api/superset/deploy      — tear down instance    │  │
│  │   GET    /api/superset/status      — health + readiness    │  │
│  │   GET    /api/superset/guest-token — generate embed token  │  │
│  │   GET    /api/superset/dashboards  — list available dashb. │  │
│  │   POST   /api/superset/load-examples — load sample data   │  │
│  │   GET    /api/superset/config      — current instance info │  │
│  │   GET    /api/health               — BFF health check      │  │
│  └──────────┬─────────────────────────────────────────────────┘  │
│             │                                                     │
│  ┌──────────▼─────────────────────────────────────────────────┐  │
│  │  Superset Instance (deployed on-demand per project)        │  │
│  │                                                            │  │
│  │  ┌─────────────────────┐    ┌───────────────────────────┐  │  │
│  │  │ Superset Pod        │    │ PostgreSQL Pod            │  │  │
│  │  │ (Gunicorn)          │    │ (metadata store)          │  │  │
│  │  │ Port 8088           │    │ Port 5432                 │  │  │
│  │  │                     │    │                           │  │  │
│  │  │ ConfigMap:          │    │ PVC: superset-postgres-pv │  │  │
│  │  │  superset_config.py │    │ Secret: postgres-creds    │  │  │
│  │  │                     │    │                           │  │  │
│  │  │ Service:            │    │ Service:                  │  │  │
│  │  │  superset-svc:8088  │    │  superset-postgres:5432   │  │  │
│  │  └─────────────────────┘    └───────────────────────────┘  │  │
│  │                                                            │  │
│  │  Optional (full mode):                                     │  │
│  │  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐    │  │
│  │  │ Redis Pod    │  │ Celery Worker │  │ Celery Beat  │    │  │
│  │  │ Port 6379    │  │ (async tasks) │  │ (scheduler)  │    │  │
│  │  └──────────────┘  └───────────────┘  └──────────────┘    │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### K8s Resources Created Per Deployment

#### Lightweight mode (default)

| Resource | Name | Purpose |
|---|---|---|
| Deployment | `superset` | Superset web app (Gunicorn) |
| Deployment | `superset-postgres` | PostgreSQL metadata database |
| Service | `superset-svc` | ClusterIP, port 8088 |
| Service | `superset-postgres-svc` | ClusterIP, port 5432 |
| ConfigMap | `superset-config` | `superset_config.py` with embedding, auth, CSP settings |
| Secret | `superset-secrets` | `SECRET_KEY`, `GUEST_TOKEN_JWT_SECRET`, Postgres password |
| PVC | `superset-postgres-pv` | Persistent storage for PostgreSQL data |
| ServiceAccount | `superset-sa` | Dedicated SA (for SCC binding on OpenShift) |
| Route (OpenShift) | `superset-route` | External access to Superset UI (for direct access / debugging) |

#### Full mode (add these)

| Resource | Name | Purpose |
|---|---|---|
| Deployment | `superset-redis` | Redis cache + Celery broker |
| Deployment | `superset-worker` | Celery worker(s) for async tasks |
| Deployment | `superset-beat` | Celery Beat scheduler (singleton) |
| Service | `superset-redis-svc` | ClusterIP, port 6379 |

### Resource Requirements

| Component | CPU Request | Memory Request | CPU Limit | Memory Limit |
|---|---|---|---|---|
| Superset web | 500m | 512Mi | 1000m | 1Gi |
| PostgreSQL | 250m | 256Mi | 500m | 512Mi |
| Redis (optional) | 100m | 128Mi | 250m | 256Mi |
| Celery Worker (optional) | 500m | 512Mi | 1000m | 1Gi |
| Celery Beat (optional) | 100m | 128Mi | 250m | 256Mi |
| **Total (lightweight)** | **750m** | **768Mi** | **1500m** | **1.5Gi** |
| **Total (full)** | **1450m** | **1.5Gi** | **3000m** | **3Gi** |

---

## 5. Embedding Architecture

### Embedded SDK

The official `@superset-ui/embedded-sdk` npm package provides a `embedDashboard()` function designed for exactly this use case.

**npm**: `@superset-ui/embedded-sdk`
**CDN**: `https://unpkg.com/@superset-ui/embedded-sdk`
**Source**: <https://github.com/apache/superset/tree/master/superset-embedded-sdk>

### Embedding Flow

```text
┌─────────────────┐         ┌─────────────────┐         ┌──────────────────┐
│  Plugin Frontend │         │  BFF Service     │         │  Superset API    │
│  (React)         │         │  (Express)       │         │  (Flask)         │
└────────┬────────┘         └────────┬────────┘         └────────┬─────────┘
         │                           │                            │
         │  1. User navigates to     │                            │
         │     embedded dashboard    │                            │
         │     page                  │                            │
         │                           │                            │
         │  2. Call fetchGuestToken  │                            │
         │ ────────────────────────► │                            │
         │   GET /api/superset/      │                            │
         │   guest-token?dashboard=X │                            │
         │                           │  3. Login to Superset API  │
         │                           │     (admin credentials)    │
         │                           │ ──────────────────────────►│
         │                           │   POST /api/v1/security/   │
         │                           │   login                    │
         │                           │ ◄──────────────────────────│
         │                           │   { access_token }         │
         │                           │                            │
         │                           │  4. Request guest token    │
         │                           │     with user context      │
         │                           │ ──────────────────────────►│
         │                           │   POST /api/v1/security/   │
         │                           │   guest_token              │
         │                           │   {                        │
         │                           │     user: { username },    │
         │                           │     resources: [{          │
         │                           │       type: "dashboard",   │
         │                           │       id: "uuid"           │
         │                           │     }],                    │
         │                           │     rls: [...]             │
         │                           │   }                        │
         │                           │ ◄──────────────────────────│
         │                           │   { token: "jwt..." }      │
         │                           │                            │
         │ ◄──────────────────────── │                            │
         │   { guestToken: "jwt..." }│                            │
         │                           │                            │
         │  5. embedDashboard()      │                            │
         │     renders iframe with   │                            │
         │     guest token           │                            │
         │ ──────────────────────────────────────────────────────►│
         │     GET /embedded/{uuid}  │                            │
         │     Authorization: Bearer │{guest_token}               │
         │                           │                            │
         │ ◄──────────────────────────────────────────────────────│
         │     Dashboard HTML        │                            │
         │     (renders in iframe)   │                            │
         │                           │                            │
```

### Frontend Embedding Code

```tsx
import { embedDashboard } from '@superset-ui/embedded-sdk';

function SupersetDashboardEmbed({ dashboardId }: { dashboardId: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    embedDashboard({
      id: dashboardId,                          // Superset dashboard UUID
      supersetDomain: supersetInstanceUrl,       // e.g. https://superset.apps.cluster.example.com
      mountPoint: mountRef.current,              // DOM element to mount iframe
      fetchGuestToken: () =>
        fetch('/apache-superset/api/superset/guest-token?dashboard=' + dashboardId)
          .then(r => r.json())
          .then(d => d.guestToken),
      dashboardUiConfig: {
        hideTitle: true,
        hideChartControls: false,
        hideTab: false,
        filters: { expanded: false },
      },
    });
  }, [dashboardId]);

  return <div ref={mountRef} style={{ width: '100%', height: '80vh' }} />;
}
```

### Guest Token Capabilities

Guest tokens are JWTs that scope access for embedded users:

```json
{
  "user": {
    "username": "embedded-user@example.com",
    "first_name": "Dashboard",
    "last_name": "Viewer"
  },
  "resources": [
    { "type": "dashboard", "id": "dashboard-uuid-here" }
  ],
  "rls": [
    { "clause": "team_id = 42" }
  ]
}
```

- **User identity**: Maps to the RHOAI dashboard user (extracted from Bearer token)
- **Resources**: Restrict which dashboards this token can access
- **RLS (Row-Level Security)**: Filter data rows visible to this user — enables multi-tenant data isolation
- **Expiration**: Controlled by `GUEST_TOKEN_JWT_EXP_SECONDS` (default 300s / 5 minutes)
- **Role**: Guest users get the role defined by `GUEST_ROLE_NAME` (set to `"EmbedGuest"` — a dedicated role auto-provisioned by the init container)

### CSP / Security Headers Configuration

Superset uses Flask-Talisman for security headers. For embedding to work, CSP must allow the dashboard host as a frame ancestor:

```python
# In superset_config.py (deployed via ConfigMap)
TALISMAN_ENABLED = True
TALISMAN_CONFIG = {
    "content_security_policy": {
        "default-src": ["'self'"],
        "img-src": ["'self'", "data:", "blob:"],
        "worker-src": ["'self'", "blob:"],
        "connect-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "script-src": ["'self'", "'unsafe-eval'"],
        "frame-ancestors": [
            "'self'",
            "https://dashboard-host.apps.cluster.example.com",
        ],
    },
    "frame_options": None,  # Disable X-Frame-Options, use CSP frame-ancestors
    "force_https": False,   # Set True if using HTTPS
}
```

Key points:

- `frame-ancestors` must list the RHOAI dashboard's origin
- `frame_options: None` disables the `X-Frame-Options` header (CSP `frame-ancestors` supersedes it)
- The BFF must know the dashboard's origin to inject it into the ConfigMap at deploy time

---

## 6. Authentication & Authorization

### Authentication Flow

The plugin bridges two authentication systems:

1. **RHOAI Dashboard** (OpenShift OAuth) -> user's Bearer token -> forwarded to BFF
2. **Superset** (local admin account) -> BFF authenticates to Superset API -> generates guest tokens

```text
User (browser)
  │
  │ Authenticated via OpenShift OAuth
  │ Bearer token in cookie/header
  │
  ▼
RHOAI Dashboard
  │
  │ Proxies /apache-superset/api/* to BFF
  │ Forwards x-forwarded-access-token header
  │
  ▼
BFF Service
  │
  │ 1. Extracts user identity from Bearer token
  │    (calls /api/status or decodes JWT)
  │
  │ 2. Authenticates to Superset API with
  │    local admin credentials (from Secret)
  │
  │ 3. Generates guest token scoped to:
  │    - User's identity (from Bearer token)
  │    - Requested dashboard(s)
  │    - Optional RLS rules
  │
  ▼
Superset API (/api/v1/security/guest_token)
```

### Admin Account Bootstrap

When the BFF deploys Superset, it must bootstrap a local admin account:

1. Superset's `superset_config.py` includes an admin user via `ADMIN_USERNAME` / `ADMIN_PASSWORD` (from Secret)
2. The init container or first-run script creates this admin: `superset fab create-admin --username admin --password <secret>`
3. The BFF stores these credentials in the same Secret and uses them for API calls
4. This admin account is never exposed to end users — it's purely for BFF-to-Superset API communication

### User Identity Mapping

| RHOAI Dashboard | Superset Guest Token |
|---|---|
| `userName` (from `/api/status`) | `user.username` |
| Bearer token claims | `user.first_name`, `user.last_name` |
| Project/namespace | Potential RLS clause |

### RBAC Considerations

- The plugin checks OpenShift RBAC before allowing deployment (via `useAccessReview`)
- Required permissions: `create` on `apps/deployments`, `core/services`, `core/configmaps`, `core/secrets`, `core/persistentvolumeclaims`
- Superset's own permissions (which dashboards a guest can see) are controlled by the guest token's `resources` array
- The `Public` role in Superset should be configured with appropriate base permissions for embedded viewers

### Optional: OIDC Integration (Advanced)

For users who want to access Superset's full UI (not just embedded dashboards), Superset can be configured with OIDC pointing to the same OpenShift OAuth server:

```python
# superset_config.py
from flask_appbuilder.security.manager import AUTH_OAUTH

AUTH_TYPE = AUTH_OAUTH
AUTH_USER_REGISTRATION = True
OAUTH_PROVIDERS = [{
    "name": "openshift",
    "token_key": "access_token",
    "icon": "fa-openshift",
    "remote_app": {
        "client_id": "<client-id>",
        "client_secret": "<client-secret>",
        "api_base_url": "https://oauth-openshift.apps.cluster.example.com/",
        "access_token_url": "https://oauth-openshift.apps.cluster.example.com/oauth/token",
        "authorize_url": "https://oauth-openshift.apps.cluster.example.com/oauth/authorize",
        "server_metadata_url": "https://oauth-openshift.apps.cluster.example.com/.well-known/oauth-authorization-server",
    }
}]
```

This is optional and more complex (requires an OAuth client registration on the cluster). The primary integration path is via guest tokens.

---

## 7. Plugin Frontend

### Extension Points

```typescript
// src/rhoai/extensions.ts

const extensions: Extension[] = [
  // Feature area
  {
    type: 'app.area',
    properties: { id: 'superset-plugin' },
  },

  // Shared community plugins nav section (reuse from hello-world pattern)
  {
    type: 'app.navigation/section',
    properties: {
      id: 'community-plugins',
      title: 'Community plugins',
      group: '9_plugins',
      iconRef: () => import('./components/CommunityNavIcon'),
    },
  },

  // Plugin nav subsection
  {
    type: 'app.navigation/section',
    properties: {
      id: 'superset-plugin',
      title: 'Superset',
      section: 'community-plugins',
      iconRef: () => import('./components/SupersetNavIcon'),
    },
  },

  // Nav items
  {
    type: 'app.navigation/href',
    properties: {
      id: 'superset-management',
      title: 'Instance',
      href: '/superset-plugin/management',
      section: 'superset-plugin',
    },
  },
  {
    type: 'app.navigation/href',
    properties: {
      id: 'superset-dashboards',
      title: 'Dashboards',
      href: '/superset-plugin/dashboards',
      section: 'superset-plugin',
    },
  },

  // Route
  {
    type: 'app.route',
    properties: {
      path: '/superset-plugin/*',
      component: () => import('./App'),
    },
  },
];
```

### Pages

#### 1. Instance Management Page

Allows the user to deploy, monitor, and tear down their Superset instance.

**States:**

- **Not deployed**: "Deploy Superset" button (with RBAC check), deployment mode selector (lightweight/full)
- **Deploying**: Progress indicators for each K8s resource being created
- **Running**: Health status, resource usage, links to Superset UI, version info
- **Error**: Error details, retry/teardown options

**Key components:**

- `useAccessReview` — check if user can create Deployments, Services, etc.
- `useSupersetDeployment` — custom hook to manage deployment lifecycle via BFF
- `useSupersetStatus` — polls BFF for instance health

#### 2. Embedded Dashboards Page

Lists available Superset dashboards and embeds them inline.

**Layout:**

- Left sidebar or top tabs: list of dashboards (fetched via BFF from Superset API)
- Main area: selected dashboard rendered via `@superset-ui/embedded-sdk`
- Toolbar: refresh, fullscreen toggle, open in Superset UI

**Key components:**

- `useSupersetDashboards` — fetches dashboard list via BFF
- `SupersetDashboardEmbed` — wraps `embedDashboard()` from the SDK
- `useSupersetGuestToken` — fetches guest tokens via BFF

### Custom Hooks

```text
src/app/hooks/
  useSupersetDeployment.ts    — deploy/teardown/status via BFF
  useSupersetStatus.ts        — health check polling
  useSupersetDashboards.ts    — list dashboards via BFF -> Superset API
  useSupersetGuestToken.ts    — fetch guest tokens for embedding
  useLoadExamples.ts          — trigger load-examples with streaming logs
```

### Dependencies

Added to plugin's `package.json`:

```json
{
  "dependencies": {
    "@superset-ui/embedded-sdk": "^0.1.0-alpha.10"
  }
}
```

Shared singletons (provided by RHOAI dashboard host, NOT bundled):

- `react`, `react-dom`, `react-router-dom`
- `@patternfly/react-core`, `@patternfly/react-icons`, `@patternfly/react-table`

---

## 8. BFF Service

### Architecture

The BFF is an Express.js + TypeScript service that:

1. Receives the user's Bearer token from the dashboard proxy
2. Makes authenticated K8s API calls to deploy/manage Superset resources
3. Communicates with the Superset REST API for guest tokens and dashboard metadata
4. Acts as the auth bridge between the RHOAI dashboard and Superset

### Endpoints

```text
BFF Service (port 3000)
│
├── GET  /api/health                    — BFF health check
│
├── POST /api/superset/deploy           — Deploy Superset instance
│   Body: { mode: "lightweight" | "full", namespace: string }
│   - Creates Deployment, Service, ConfigMap, Secret, PVC
│   - Bootstraps admin user
│   - Returns deployment status
│
├── DELETE /api/superset/deploy          — Tear down Superset instance
│   Query: ?namespace=<ns>
│   - Deletes all Superset K8s resources
│   - Confirms no data loss (or warns about PVC)
│
├── GET  /api/superset/status            — Instance status
│   - Checks Deployment readiness
│   - Pings Superset health endpoint
│   - Returns: { deployed, ready, url, version, mode }
│
├── GET  /api/superset/guest-token       — Generate embed guest token
│   Query: ?dashboard=<uuid>
│   - Authenticates to Superset API (admin creds from Secret)
│   - Generates guest token scoped to the dashboard + user identity
│   - Returns: { guestToken: "jwt..." }
│
├── GET  /api/superset/dashboards        — List dashboards
│   - Calls Superset API /api/v1/dashboard/
│   - Returns: { dashboards: [{ id, title, url, status }] }
│
├── POST /api/superset/load-examples     — Load example data
│   - Executes `superset load-examples` in the Superset pod via K8s exec WebSocket
│   - Streams stdout/stderr back to the frontend
│
└── GET  /api/superset/config            — Current instance configuration
    - Returns instance URL, mode, version, resource usage
```

### BFF-to-Superset Authentication

The BFF maintains a Superset admin session for API calls:

```typescript
class SupersetClient {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await fetch(`${this.supersetUrl}/api/v1/security/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'db',
        username: process.env.SUPERSET_ADMIN_USERNAME,
        password: process.env.SUPERSET_ADMIN_PASSWORD,
        refresh: true,
      }),
    });

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + 3600_000; // 1 hour
    return this.accessToken;
  }

  async generateGuestToken(dashboardId: string, user: UserInfo): Promise<string> {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.supersetUrl}/api/v1/security/guest_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        user: {
          username: user.userName,
          first_name: user.firstName || user.userName,
          last_name: user.lastName || '',
        },
        resources: [{ type: 'dashboard', id: dashboardId }],
        rls: [],
      }),
    });

    const data = await response.json();
    return data.token;
  }
}
```

### Dashboard Proxy Configuration

The RHOAI dashboard proxies BFF requests via the federation ConfigMap:

```json
{
  "proxyService": [{
    "path": "/apache-superset/api",
    "pathRewrite": "/api",
    "authorize": true,
    "tls": false,
    "service": {
      "name": "apache-superset-bff",
      "namespace": "apache-superset",
      "port": 3000
    }
  }]
}
```

### K8s Resource Generation

The BFF programmatically generates K8s manifests for the Superset deployment. Example for the main Deployment:

```typescript
function buildSupersetDeployment(namespace: string, mode: 'lightweight' | 'full'): object {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: 'superset',
      namespace,
      labels: { 'app.kubernetes.io/name': 'superset', 'app.kubernetes.io/managed-by': 'superset-plugin' },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { 'app.kubernetes.io/name': 'superset' } },
      template: {
        metadata: { labels: { 'app.kubernetes.io/name': 'superset' } },
        spec: {
          serviceAccountName: 'superset-sa',
          securityContext: { runAsNonRoot: true, seccompProfile: { type: 'RuntimeDefault' } },
          containers: [{
            name: 'superset',
            image: 'apache/superset:latest',
            ports: [{ containerPort: 8088 }],
            envFrom: [
              { configMapRef: { name: 'superset-config' } },
              { secretRef: { name: 'superset-secrets' } },
            ],
            resources: {
              requests: { cpu: '500m', memory: '512Mi' },
              limits: { cpu: '1000m', memory: '1Gi' },
            },
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] },
            },
            readinessProbe: {
              httpGet: { path: '/health', port: 8088 },
              initialDelaySeconds: 30,
              periodSeconds: 10,
            },
            livenessProbe: {
              httpGet: { path: '/health', port: 8088 },
              initialDelaySeconds: 60,
              periodSeconds: 30,
            },
          }],
        },
      },
    },
  };
}
```

---

## 9. Helm Chart Design

### Chart Structure

```text
chart/
├── Chart.yaml
├── values.yaml
├── templates/
│   ├── _helpers.tpl
│   ├── serviceaccount.yaml
│   │
│   │  # Plugin infrastructure (always deployed)
│   ├── plugin-deployment.yaml          # Frontend (Nginx)
│   ├── plugin-service.yaml
│   ├── bff-deployment.yaml             # BFF (Express.js)
│   ├── bff-service.yaml
│   │
│   │  # Superset instance (deployed on-demand via BFF, or pre-deployed via Helm)
│   ├── superset-deployment.yaml        # Superset web app
│   ├── superset-service.yaml
│   ├── superset-configmap.yaml         # superset_config.py
│   ├── superset-secret.yaml            # Admin creds, SECRET_KEY, JWT secret
│   ├── superset-init-job.yaml          # Bootstrap admin user + DB migration
│   ├── postgres-deployment.yaml        # PostgreSQL
│   ├── postgres-service.yaml
│   ├── postgres-pvc.yaml
│   │
│   │  # Optional full-mode components
│   ├── redis-deployment.yaml           # (gated by .Values.superset.redis.enabled)
│   ├── redis-service.yaml
│   ├── celery-worker-deployment.yaml   # (gated by .Values.superset.celery.enabled)
│   ├── celery-beat-deployment.yaml     # (gated by .Values.superset.celery.enabled)
│   │
│   │  # OpenShift-specific
│   ├── superset-route.yaml             # (gated by .Values.superset.route.enabled)
│   └── superset-scc.yaml              # (gated by .Values.openshift.scc.create)
```

### values.yaml (key sections)

```yaml
# Plugin frontend
image:
  repository: quay.io/rh-ai-community-plugins/superset-plugin
  tag: latest
  pullPolicy: IfNotPresent

# Plugin BFF
bff:
  enabled: true
  image:
    repository: quay.io/rh-ai-community-plugins/superset-plugin-bff
    tag: latest

# Superset instance
superset:
  enabled: true    # Set false if Superset is deployed separately / on-demand only
  image:
    repository: apache/superset
    tag: "4.1.1"   # Pin to a specific version
  port: 8088

  # Deployment mode
  mode: lightweight  # "lightweight" or "full"

  # Admin bootstrap
  admin:
    username: admin
    # password: set via --set or existingSecret
    firstName: Superset
    lastName: Admin
    email: admin@superset.local

  # Embedding configuration
  embedding:
    enabled: true
    guestTokenJwtSecret: ""   # Auto-generated if empty
    guestTokenExpSeconds: 300
    allowedOrigins:
      - "https://dashboard-host.apps.cluster.example.com"

  # Resources
  resources:
    requests:
      cpu: 500m
      memory: 512Mi
    limits:
      cpu: 1000m
      memory: 1Gi

  # PostgreSQL
  postgres:
    enabled: true
    image:
      repository: registry.redhat.io/rhel9/postgresql-16
      tag: "latest"
    persistence:
      size: 5Gi
      storageClass: ""   # Use cluster default

  # Redis (full mode only)
  redis:
    enabled: false
    image:
      repository: bitnami/redis
      tag: "7"

  # Celery (full mode only)
  celery:
    enabled: false
    workers: 1
    concurrency: 4

  # OpenShift Route
  route:
    enabled: true
    host: ""   # Auto-assigned if empty

# OpenShift-specific
openshift:
  scc:
    create: true   # Create SecurityContextConstraints
    name: superset-scc
```

---

## 10. OpenShift Compatibility

### The Problem

OpenShift's default `restricted` SCC:

- Runs containers with a **random UID** from a pre-allocated range
- Always assigns **GID 0** as supplemental group
- Rejects containers that require root

The official `apache/superset` image needs adaptation.

### Solutions (in order of preference)

#### Option A: Hardened image variant (recommended)

Docker Hardened Images for Superset exist and run as nonroot (UID 65532). Alternatively, build a custom image:

```dockerfile
FROM apache/superset:4.1.1

USER root

# Make writable directories group-accessible (OpenShift assigns random UID with GID 0)
RUN chgrp -R 0 /app/superset_home /app/pythonpath && \
    chmod -R g=u /app/superset_home /app/pythonpath

# Switch to non-root user
USER 1001
```

This image works with OpenShift's `restricted` SCC because:

- It runs as non-root (UID 1001)
- All writable paths are group-writable by GID 0
- OpenShift's random UID will have GID 0 as supplemental group

#### Option B: Custom SCC

Create a dedicated SCC that allows a specific non-root UID:

```yaml
apiVersion: security.openshift.io/v1
kind: SecurityContextConstraints
metadata:
  name: superset-scc
allowHostDirVolumePlugin: false
allowHostIPC: false
allowHostNetwork: false
allowHostPID: false
allowHostPorts: false
allowPrivilegedContainer: false
allowPrivilegeEscalation: false
runAsUser:
  type: MustRunAs
  uid: 1001
seLinuxContext:
  type: MustRunAs
fsGroup:
  type: MustRunAs
  ranges:
    - min: 1001
      max: 1001
supplementalGroups:
  type: RunAsAny
volumes:
  - configMap
  - emptyDir
  - persistentVolumeClaim
  - projected
  - secret
```

#### Option C: anyuid SCC (last resort)

Grant `anyuid` to the Superset service account. Simplest but weakens security:

```bash
oc adm policy add-scc-to-user anyuid -z superset-sa -n <namespace>
```

This requires cluster-admin privileges, which may not be available to plugin users.

### PostgreSQL on OpenShift

The sub-chart uses `registry.redhat.io/rhel9/postgresql-16`, Red Hat's official PostgreSQL image. This image is purpose-built for OpenShift:

- Runs as non-root and supports random UIDs (compatible with the `restricted` SCC out of the box)
- Uses Red Hat-specific environment variable names: `POSTGRESQL_USER`, `POSTGRESQL_PASSWORD`, `POSTGRESQL_DATABASE` (not the upstream `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` convention used by the Docker Hub image)
- Data directory is `/var/lib/pgsql/data` (not `/var/lib/postgresql/data`)
- Readiness/liveness probes use `/usr/libexec/check-container` (provided by the image), not a generic `pg_isready` command

---

## 11. Configuration Reference

### Superset Configuration (superset_config.py)

The ConfigMap contains the full `superset_config.py`. Key settings for the plugin:

```python
import os

# --- Core ---
SECRET_KEY = os.environ.get("SUPERSET_SECRET_KEY", "CHANGE_ME_IN_PRODUCTION")
SQLALCHEMY_DATABASE_URI = os.environ.get(
    "SUPERSET_SQLALCHEMY_DATABASE_URI",
    "postgresql+psycopg2://superset:superset@superset-postgres-svc:5432/superset"
)

# --- Embedding ---
FEATURE_FLAGS = {
    "EMBEDDED_SUPERSET": True,
    "ALERT_REPORTS": False,          # Disable if no Celery
}

GUEST_ROLE_NAME = "EmbedGuest"
GUEST_TOKEN_JWT_SECRET = os.environ.get("SUPERSET_GUEST_TOKEN_JWT_SECRET", SECRET_KEY)
GUEST_TOKEN_JWT_EXP_SECONDS = int(os.environ.get("SUPERSET_GUEST_TOKEN_JWT_EXP_SECONDS", "300"))

# --- Security / CSP ---
TALISMAN_ENABLED = True
TALISMAN_CONFIG = {
    "content_security_policy": {
        "default-src": ["'self'"],
        "img-src": ["'self'", "data:", "blob:"],
        "worker-src": ["'self'", "blob:"],
        "connect-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "script-src": ["'self'", "'unsafe-eval'"],
        "frame-ancestors": ["'self'"] + os.environ.get(
            "SUPERSET_ALLOWED_ORIGINS", ""
        ).split(","),
    },
    "frame_options": None,
    "force_https": os.environ.get("SUPERSET_FORCE_HTTPS", "false").lower() == "true",
}

# For cross-origin embedded SDK usage
SESSION_COOKIE_SAMESITE = "None"
SESSION_COOKIE_SECURE = True
ENABLE_PROXY_FIX = True

# --- CSRF ---
# Guest token requests from the BFF need CSRF exemption
WTF_CSRF_ENABLED = True
WTF_CSRF_EXEMPT_LIST = [
    "superset.security.api",
]

# --- Cache (lightweight mode — no Redis) ---
CACHE_CONFIG = {
    "CACHE_TYPE": "SimpleCache",
    "CACHE_DEFAULT_TIMEOUT": 300,
}
DATA_CACHE_CONFIG = CACHE_CONFIG
FILTER_STATE_CACHE_CONFIG = CACHE_CONFIG
EXPLORE_FORM_DATA_CACHE_CONFIG = CACHE_CONFIG

# --- Celery (disabled in lightweight mode) ---
# Uncomment for full mode:
# from celery.schedules import crontab
# class CeleryConfig:
#     broker_url = "redis://superset-redis-svc:6379/0"
#     result_backend = "redis://superset-redis-svc:6379/1"
# CELERY_CONFIG = CeleryConfig

# --- Web server ---
SUPERSET_WEBSERVER_PORT = 8088
ROW_LIMIT = 50000
SUPERSET_WEBSERVER_TIMEOUT = 120
```

### Environment Variables Reference

| Variable | Purpose | Default |
|---|---|---|
| `SUPERSET_SECRET_KEY` | Flask SECRET_KEY for session signing | (must be set) |
| `SUPERSET_SQLALCHEMY_DATABASE_URI` | PostgreSQL connection string | `postgresql+psycopg2://...` |
| `SUPERSET_GUEST_TOKEN_JWT_SECRET` | Secret for signing guest tokens | Same as SECRET_KEY |
| `SUPERSET_GUEST_TOKEN_JWT_EXP_SECONDS` | Guest token expiration | `300` |
| `SUPERSET_ALLOWED_ORIGINS` | Comma-separated origins for CSP frame-ancestors | (empty) |
| `SUPERSET_FORCE_HTTPS` | Enable HTTPS enforcement | `false` |
| `SUPERSET_ADMIN_USERNAME` | Admin username for BFF API access | `admin` |
| `SUPERSET_ADMIN_PASSWORD` | Admin password for BFF API access | (from Secret) |
| `SUPERSET_WEBSERVER_PORT` | Web server listen port | `8088` |

---

## 12. Development Setup

### Prerequisites

- Node.js 20+
- An RHOAI dashboard running locally (`localhost:8443`) or accessible remotely
- Docker (for running Superset locally)

### Local Development

```bash
# 1. Start Superset locally (lightweight mode)
docker run -d \
  --name superset-dev \
  -p 8088:8088 \
  -e SUPERSET_SECRET_KEY=dev-secret-key \
  -e TALISMAN_ENABLED=false \
  apache/superset:4.1.1

# Initialize Superset (first time only)
docker exec -it superset-dev superset db upgrade
docker exec -it superset-dev superset fab create-admin \
  --username admin --firstname Admin --lastname User \
  --email admin@example.com --password admin
docker exec -it superset-dev superset init

# 2. Start the BFF
cd bff
SUPERSET_URL=http://localhost:8088 \
SUPERSET_ADMIN_USERNAME=admin \
SUPERSET_ADMIN_PASSWORD=admin \
K8S_API_BASE=$(oc whoami --show-server) \
npm run start:dev

# 3. Start the plugin frontend
npm run start:dev
```

### Webpack Dev Proxy Configuration

```javascript
// config/webpack.dev.js
module.exports = merge(common, {
  devServer: {
    port: 9500,
    proxy: [
      {
        context: ['/apache-superset/api'],
        target: 'http://localhost:3000',
        pathRewrite: { '^/apache-superset/api': '/api' },
      },
      {
        context: ['/superset-plugin'],
        target: 'http://localhost:8443',
        pathRewrite: { '^/superset-plugin': '/superset-plugin' },
      },
    ],
  },
});
```

---

## 13. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **OpenShift SCC compatibility** | High | Build and maintain a nonroot image with GID 0 permissions. Publish on Quay.io. |
| **Superset startup time** | Medium | Superset takes 30-60s to start (Python app + DB migrations). Show clear loading state. Add readiness probes. |
| **Guest token expiration** | Medium | Default 5-minute TTL. The embedded SDK's `fetchGuestToken` is called automatically on expiry. Ensure the BFF endpoint is fast. |
| **CSP misconfiguration** | Medium | Generate the ConfigMap dynamically with the correct dashboard origin. Validate at deploy time. |
| **Superset API auth** | Medium | The admin account credentials are stored in a K8s Secret. BFF caches the access token and refreshes on expiry. |
| **Resource consumption** | Medium | Superset is a Python/Java app. Set conservative resource limits. Consider HPA for production use. |
| **Superset version upgrades** | Low | Pin to a specific Superset version in the Helm chart. Test upgrades separately. DB migrations run automatically on startup. |
| **Data warehouse security** | Low | Superset connects to the user's data warehouse directly. Credentials are stored in Superset's encrypted metadata DB (encrypted with `SECRET_KEY`). |
| **Sub-path routing** | Low | Avoid sub-path routing for the Superset UI. Use a dedicated Route for direct access. The embedded SDK points directly at the Superset Service/Route URL. |

---

## 14. Alternative Tools Considered

A feasibility analysis was conducted on five tools. Full findings are summarized below for reference.

### n8n (Workflow Automation)

- **License**: Sustainable Use License (NOT open source) — embedding requires paid Embed License
- **Embedding**: `X-Frame-Options: DENY` hardcoded, no config to disable. Same-origin reverse proxy is the only workaround, but sub-path deployment has known bugs
- **Verdict**: License is a blocker. Embedding is technically painful. Not recommended.

### Metabase (BI/Analytics)

- **License**: AGPL v3 — copyleft. Custom OpenShift image triggers source disclosure obligations
- **Embedding**: Static embedding (JWT iframes) works in OSS but shows mandatory "Powered by Metabase" badge. Interactive/full-app embedding requires Pro ($500+/mo). SSO also Pro-only.
- **OpenShift**: Official image runs as root. No nonroot variant. Must build custom image (triggers AGPL).
- **Strengths**: Best product UX, can run with embedded H2 (zero dependencies), comprehensive API
- **Verdict**: Viable technically but AGPL + badge + paywalled SSO make it impractical for Red Hat ecosystem.

### Lightdash (dbt-native BI)

- **License**: MIT core, but enterprise features (including embedding) under proprietary "Source Available License"
- **Embedding**: Paywalled — requires Lightdash Cloud or Enterprise On-Prem license ($790/mo or $0.05/view). Not available in self-hosted OSS.
- **OpenShift**: Container runs as root (open issue #20322, unfixed). No sub-path support.
- **Verdict**: Embedding paywall is a hard blocker. Also dbt-specific, limiting audience. Not recommended.

### Redash (SQL Dashboarding)

- **License**: BSD-2-Clause — maximally permissive, no restrictions
- **Embedding**: iframe embedding works with `REDASH_FRAME_OPTIONS=""`. Public/secret URLs for anonymous viewing. No SDK.
- **Auth**: `REDASH_REMOTE_USER_LOGIN_ENABLED` enables proxy auth — cleanest SSO integration of all tools
- **OpenShift**: Needs image patching for random UID support
- **Deployment**: Heavy — 6 pods minimum (server + scheduler + 2 workers + Postgres + Redis). No lightweight mode.
- **Project health**: Community reboot after near-abandonment. 7 volunteer maintainers. Recent releases (v25.8.0 Aug 2025) show momentum but long-term uncertain.
- **Verdict**: License-clean and good auth story, but heavy deployment and uncertain project future. Viable as a simpler alternative if Superset's footprint is too much.

### Apache Superset (Selected)

- **License**: Apache 2.0 — fully permissive, zero legal risk
- **Embedding**: React SDK (`@superset-ui/embedded-sdk`), guest tokens, row-level security — all free in OSS
- **Auth**: Guest tokens via API, optional OIDC for full UI access
- **OpenShift**: Nonroot variants available, Red Hat PostgreSQL (`registry.redhat.io/rhel9/postgresql-16`) works with restricted SCC
- **Deployment**: 2 pods minimum (lightweight mode), 5 pods full mode. Official Helm chart.
- **Project health**: Apache Foundation governance, very active development, large community
- **Verdict**: Best overall. Selected for implementation.
