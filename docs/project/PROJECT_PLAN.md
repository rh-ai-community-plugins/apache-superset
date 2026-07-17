# Apache Superset RHOAI Dashboard Plugin — Project Plan

## Overview

Transform the scaffolded `apache-superset` seed plugin into a fully functional RHOAI Dashboard community plugin that:

1. **Deploys Apache Superset on-demand** into a user's OpenShift project (lightweight mode: Superset + PostgreSQL, 2 pods)
2. **Embeds Superset dashboards inline** within the RHOAI Dashboard using the official `@superset-ui/embedded-sdk` React SDK
3. **Bridges authentication** so the RHOAI Dashboard user's identity is mapped to Superset guest tokens for scoped, identity-aware dashboard access

The plugin follows established RHOAI community plugin patterns: Module Federation for frontend integration, a BFF (Backend-for-Frontend) Express.js service for server-side orchestration, and Helm chart packaging for deployment.

## Architecture

```text
┌───────────────────────────────────────────────────────────────────┐
│  RHOAI Dashboard Host                                             │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Apache Superset Plugin (Module Federation)                 │  │
│  │                                                             │  │
│  │  Pages:                                                     │  │
│  │   - Instance Management  — deploy / status / teardown       │  │
│  │   - Embedded Dashboards  — browse & view dashboards inline  │  │
│  │                                                             │  │
│  │  Hooks:                                                     │  │
│  │   useSupersetDeployment  — deploy/teardown lifecycle        │  │
│  │   useSupersetStatus      — health-check polling             │  │
│  │   useSupersetDashboards  — list dashboards via BFF          │  │
│  │   useSupersetGuestToken  — fetch guest token for embedding  │  │
│  │   useAccessReview        — RBAC permission checks (kept)    │  │
│  │   useCurrentUser         — user identity (kept)             │  │
│  │   useProjects            — project listing (kept)           │  │
│  │                                                             │  │
│  │  Components:                                                │  │
│  │   SupersetDashboardEmbed — wraps @superset-ui/embedded-sdk  │  │
│  │   DeploymentStatusCard   — deploy/running/error display     │  │
│  │   ProjectSelector        — namespace picker (kept)          │  │
│  └──────────┬──────────────────────────────────────────────────┘  │
│             │  /apache-superset/api/*                             │
│  ┌──────────▼──────────────────────────────────────────────────┐  │
│  │  BFF Service (Express.js, port 3000)                        │  │
│  │                                                             │  │
│  │  POST   /api/superset/deploy      — deploy via Helm         │  │
│  │  DELETE /api/superset/deploy      — tear down instance      │  │
│  │  GET    /api/superset/status      — health + readiness      │  │
│  │  GET    /api/superset/guest-token — generate embed token    │  │
│  │  GET    /api/superset/dashboards  — list dashboards         │  │
│  │  GET    /api/superset/config      — instance configuration  │  │
│  │  GET    /api/health               — BFF health check        │  │
│  │                                                             │  │
│  │  SupersetClient — admin auth, token cache, guest tokens     │  │
│  │  HelmDeployer   — render & apply Helm-templated manifests   │  │
│  └──────────┬──────────────────────────────────────────────────┘  │
│             │  K8s API + Superset REST API                       │
│  ┌──────────▼──────────────────────────────────────────────────┐  │
│  │  Superset Instance (per-namespace, on-demand)               │  │
│  │                                                             │  │
│  │  ┌─────────────────────┐    ┌────────────────────────────┐  │  │
│  │  │ superset pod        │    │ superset-postgres pod      │  │  │
│  │  │ (Gunicorn :8088)    │    │ (PostgreSQL :5432)         │  │  │
│  │  │ nonroot image       │    │ (Bitnami nonroot image)    │  │  │
│  │  │ ConfigMap: config   │    │ PVC: superset-postgres-pv  │  │  │
│  │  │ Secret: creds       │    │ Secret: postgres-creds     │  │  │
│  │  └─────────────────────┘    └────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

### Key Design Points

- **Helm-managed deployment**: The BFF renders Helm-templated K8s manifests from a sub-chart (`chart/charts/superset/`) and applies them via the K8s API. Resource definitions live in one place (chart templates), not in TypeScript.
- **Custom nonroot Superset image**: A `Containerfile.superset` builds a nonroot variant of `apache/superset:4.1.1` compatible with OpenShift's `restricted` SCC. Published to Quay.io alongside the plugin's frontend and BFF images.
- **Guest token auth bridge**: The BFF authenticates to Superset with admin credentials (from K8s Secret), then generates scoped guest tokens carrying the RHOAI user's identity. The frontend never touches admin credentials.
- **Two pages only**: Instance Management and Embedded Dashboards. Data connections are managed at the dashboard project level (already handled there).
- **Retained hooks**: `useAccessReview`, `useCurrentUser`, `useProjects`, `useFavoriteProjects`, `useLastSelectedProject`, and `ProjectSelector` are reused from the seed.

---

## Navigation & Page Structure

```text
RHOAI Dashboard Sidebar
└── Community Plugins (shared section)
    └── Apache Superset (plugin subsection)
        ├── Instance    → /apache-superset/instance
        └── Dashboards  → /apache-superset/dashboards
```

**Instance Management Page** (`/apache-superset/instance`)

- States: not-deployed | deploying | running | error
- Not deployed: project selector, RBAC check, "Deploy Superset" button
- Deploying: progress indicators for each K8s resource
- Running: health status card, version info, link to Superset UI (via Route)
- Error: error details, retry and teardown buttons

**Embedded Dashboards Page** (`/apache-superset/dashboards`)

- Requires a running Superset instance (shows prompt if none)
- Dashboard list (cards) fetched from Superset API via BFF
- Click a dashboard → embed inline via `@superset-ui/embedded-sdk`
- Guest token fetched transparently; SDK auto-refreshes on expiry
- Toolbar: refresh, fullscreen toggle, open-in-Superset link

---

## Phases

### Phase 1: Clean Slate — Remove Seed Content & Update Routing

**Goal**: Strip all seed/demo pages, hooks, and BFF endpoints; establish the new navigation and routing structure.

**Deliverables**:

1. **Remove seed pages and their tests**
   - Delete `UserInfoPage.tsx`, `ClusterResourcesPage.tsx`, `NamespaceSummaryPage.tsx` and their `__tests__/` spec files

2. **Remove seed-only hooks and their tests**
   - Delete `useK8sResources.ts`, `useNamespaceSummary.ts` and their spec files

3. **Retain reusable hooks** (no changes needed)
   - `useAccessReview.ts` (RBAC checks for deploy permission)
   - `useCurrentUser.ts` (user identity for guest tokens)
   - `useProjects.ts`, `useFavoriteProjects.ts`, `useLastSelectedProject.ts` (namespace picker)

4. **Retain reusable components** (no changes needed)
   - `CommunityBanner.tsx` + `.css`, `ApacheSupersetNavIcon.tsx`, `ProjectSelector.tsx`

5. **Update `src/rhoai/extensions.ts`**
   - Replace three seed nav items (`userInfoNavExtension`, `clusterResourcesNavExtension`, `namespaceSummaryNavExtension`) with:
     - `instanceNavExtension`: id `apache-superset-instance`, title `Instance`, href `/apache-superset/instance`
     - `dashboardsNavExtension`: id `apache-superset-dashboards`, title `Dashboards`, href `/apache-superset/dashboards`
   - Keep: `communityPluginsSectionExtension`, `apacheSupersetAreaExtension`, `apacheSupersetSectionExtension`, `apacheSupersetRouteExtension`
   - Result: 6 extensions total

6. **Update `src/app/App.tsx`**
   - Replace three seed routes with:
     - `/instance/*` → placeholder `InstanceManagementPage`
     - `/dashboards/*` → placeholder `EmbeddedDashboardsPage`
   - Default redirect from `/` to `instance`
   - Keep `CommunityBanner` wrapper

7. **Create placeholder pages**
   - `src/app/pages/InstanceManagementPage.tsx` — minimal PatternFly `PageSection` with title
   - `src/app/pages/EmbeddedDashboardsPage.tsx` — minimal PatternFly `PageSection` with title

8. **Clean up BFF**
   - Delete `bff/src/routes/namespaceSummary.ts` and its test
   - Remove import and route from `bff/src/server.ts`
   - Clean seed types from `bff/src/types.ts` (`PodCounts`, `NamespaceInfo`, etc.)

9. **Update tests**
   - Rewrite `extensions.spec.ts` for the new 6-extension structure
   - Rewrite `App.spec.tsx` for the new two-route structure

10. **Validate** — `npm run lint && npm test` and `cd bff && npm run lint && npm test` pass with zero seed content

**Dependencies**: None (starting point).
**Estimated effort**: 1 day.

---

### Phase 2: Custom Superset Container Image

**Goal**: Build and publish a nonroot Superset image compatible with OpenShift's `restricted` SCC.

**Deliverables**:

1. **Create `Containerfile.superset`** at repo root
   - Base: `apache/superset:4.1.1` (pinned)
   - `chgrp -R 0 /app/superset_home /app/pythonpath && chmod -R g=u /app/superset_home /app/pythonpath`
   - `USER 1001`

2. **Update Makefile** — add `image-build-superset` and `image-push-superset` targets; update `image-build` and `image-push` to include the superset image

3. **Update `scripts/build-push.sh`** — add `superset` as a valid target (image name `apache-superset-server`, Containerfile `Containerfile.superset`)

4. **Update `.github/workflows/build-push.yml`** — add `build-and-push-superset` job parallel to frontend and BFF jobs

5. **Update `scripts/scan-image.sh`** — include the Superset image in the `all` target

6. **Update `docs/development/BUILD_AND_PUSH.md`** — document the Superset server image build

**Dependencies**: None (can run in parallel with Phase 1).
**Estimated effort**: 1 day.

---

### Phase 3: Superset Helm Sub-Chart

**Goal**: Create a Helm sub-chart defining all K8s resources for a per-namespace Superset deployment (lightweight mode).

**Deliverables**:

1. **Create sub-chart structure** under `chart/charts/superset/`:
   - `Chart.yaml` — name `superset`, appVersion `4.1.1`
   - `values.yaml` — image, port, admin, embedding, resources, postgres, route defaults
   - `templates/_helpers.tpl` — naming, labels, selector helpers

2. **Superset templates**:
   - `superset-deployment.yaml` — Gunicorn pod, nonroot security context, port 8088, envFrom ConfigMap/Secret, readiness/liveness probes on `/health`, resource limits
   - `superset-service.yaml` — ClusterIP on port 8088
   - `superset-configmap.yaml` — `superset_config.py` with `EMBEDDED_SUPERSET: True`, guest token config, CSP `frame-ancestors` from env, `SimpleCache`, CSRF exempt list (per architecture doc Section 11)
   - `superset-secret.yaml` — `SECRET_KEY`, `GUEST_TOKEN_JWT_SECRET`, `ADMIN_PASSWORD`, `POSTGRES_PASSWORD`, `SQLALCHEMY_DATABASE_URI`
   - `superset-init-job.yaml` — Job running `superset db upgrade`, `superset fab create-admin`, `superset init`; `restartPolicy: OnFailure`
   - `superset-serviceaccount.yaml` — dedicated SA for Superset pods
   - `superset-route.yaml` — OpenShift Route (gated by `route.enabled`), TLS edge termination

3. **PostgreSQL templates**:
   - `postgres-deployment.yaml` — Bitnami PostgreSQL 16, nonroot (UID 1001), port 5432, PVC mount
   - `postgres-service.yaml` — ClusterIP on port 5432
   - `postgres-pvc.yaml` — size from values (default 5Gi)

4. **Update parent chart**:
   - Add `superset:` section to `chart/values.yaml` with `enabled: false` and sub-chart value overrides
   - Add dependency in `chart/Chart.yaml` (condition: `superset.enabled`)

5. **Validate** — `helm lint chart/` and `helm template chart/` pass

**Dependencies**: Phase 2 (Superset image name for values.yaml).
**Estimated effort**: 3 days.

---

### Phase 4: BFF — SupersetClient & Core Infrastructure

**Goal**: Build the BFF's Superset API client, Helm manifest renderer, and K8s CRUD utilities.

**Deliverables**:

1. **Add BFF dependencies** to `bff/package.json`
   - `js-yaml` for parsing Helm chart YAML templates

2. **Create `bff/src/utils/supersetClient.ts`** — `SupersetClient` class:
   - `getAccessToken()` — POST `/api/v1/security/login`, cache with 1h TTL
   - `generateGuestToken(dashboardId, user)` — POST `/api/v1/security/guest_token` with user identity and dashboard resource scoping
   - `listDashboards()` — GET `/api/v1/dashboard/`, return `{ id, title, url, status, embeddedId }[]`
   - `getSupersetHealth()` — GET `/health`, return `{ healthy, version }`

3. **Create `bff/src/utils/helmRenderer.ts`** — simplified template renderer:
   - Read YAML templates from the sub-chart directory
   - Replace Helm variables (`{{ .Values.x }}`, `{{ .Release.Namespace }}`, etc.) with provided values
   - Return array of parsed K8s resource objects
   - NOTE: simplified renderer for known templates, not full Helm engine

4. **Create `bff/src/utils/k8sApply.ts`** — K8s resource CRUD:
   - `applyResource(token, resource)` — create or update (POST, handle 409 conflict with PUT)
   - `deleteResource(token, apiVersion, kind, namespace, name)`
   - `getResource(token, apiVersion, kind, namespace, name)`
   - `listResources(token, apiVersion, kind, namespace, labelSelector)`

5. **Extend `bff/src/utils/k8sClient.ts`** — add POST, PUT, DELETE support and request body handling (currently GET-only)

6. **Rewrite `bff/src/types.ts`** — replace seed types with:
   - `SupersetDeployRequest`, `SupersetStatus`, `SupersetDashboard`, `GuestTokenResponse`, `UserInfo`, `SupersetConfig`

7. **Write tests** — `supersetClient.test.ts`, `helmRenderer.test.ts`, `k8sApply.test.ts`

8. **Validate** — `cd bff && npm run lint && npm test` passes

**Dependencies**: Phase 1 (clean BFF types), Phase 3 (sub-chart templates for helmRenderer).
**Estimated effort**: 3 days.

---

### Phase 5: BFF — Deployment & Status Endpoints

**Goal**: Implement BFF REST endpoints for deploying, tearing down, and checking status of a Superset instance.

**Deliverables**:

1. **Create `bff/src/routes/supersetDeploy.ts`**:
   - `POST /api/superset/deploy` — validate RBAC (SelfSubjectAccessReview), generate secrets, render Helm templates, apply K8s resources, return status
   - `DELETE /api/superset/deploy?namespace=<ns>` — list resources by label `app.kubernetes.io/managed-by: superset-plugin`, delete all, return status

2. **Create `bff/src/routes/supersetStatus.ts`**:
   - `GET /api/superset/status?namespace=<ns>` — check Deployment readiness, ping Superset `/health`, get Route URL, return `SupersetStatus`

3. **Create `bff/src/routes/supersetConfig.ts`**:
   - `GET /api/superset/config?namespace=<ns>` — read ConfigMap/Secret metadata, return instance URL, mode, version

4. **Create `bff/src/middleware/auth.ts`** — extract Bearer token from `Authorization` or `x-forwarded-access-token` header, attach to `req.token`, return 401 if absent

5. **Update `bff/src/server.ts`** — add `express.json()` middleware, register deploy/status/config routes with auth middleware

6. **Write tests** — `supersetDeploy.test.ts`, `supersetStatus.test.ts`, `auth.test.ts`

7. **Validate** — `cd bff && npm run lint && npm test` passes

**Dependencies**: Phase 4 (SupersetClient, k8sApply, helmRenderer, types).
**Estimated effort**: 3 days.

---

### Phase 6: BFF — Guest Token & Dashboard Listing Endpoints

**Goal**: Implement BFF endpoints that bridge frontend embedding requests to the Superset API.

**Deliverables**:

1. **Create `bff/src/routes/supersetGuestToken.ts`**:
   - `GET /api/superset/guest-token?dashboard=<uuid>&namespace=<ns>` — extract user identity from Bearer token (via dashboard `/api/status` or JWT decode), read admin credentials from namespace Secret, generate guest token via `SupersetClient`, return `{ guestToken }`

2. **Create `bff/src/routes/supersetDashboards.ts`**:
   - `GET /api/superset/dashboards?namespace=<ns>` — read admin credentials, call `SupersetClient.listDashboards()`, transform and return `{ dashboards: SupersetDashboard[] }`

3. **Create `bff/src/utils/userIdentity.ts`** — `getUserInfo(token)`: call dashboard `/api/status`, extract `userName`/`firstName`/`lastName`

4. **Create `bff/src/utils/secretReader.ts`** — `getAdminCredentials(token, namespace)` and `getSupersetUrl(token, namespace)`: read the Superset Secret and Route/Service from K8s API

5. **Update `bff/src/server.ts`** — register guest-token and dashboards routes

6. **Write tests** — `supersetGuestToken.test.ts`, `supersetDashboards.test.ts`, `userIdentity.test.ts`

7. **Validate** — `cd bff && npm run lint && npm test` passes

**Dependencies**: Phases 4 and 5 (SupersetClient, auth middleware, server structure).
**Estimated effort**: 2 days.

---

### Phase 7: Frontend — Instance Management Page

**Goal**: Build the Instance Management page with full deploy/monitor/teardown lifecycle UI.

**Deliverables**:

1. **Create `src/app/hooks/useSupersetDeployment.ts`**
   - `deploy(namespace, dashboardOrigin)` — POST to BFF
   - `teardown(namespace)` — DELETE to BFF
   - Returns `{ deploy, teardown, deploying, tearing, error }`

2. **Create `src/app/hooks/useSupersetStatus.ts`**
   - Poll `GET /apache-superset/api/superset/status?namespace=<ns>` every 10s (30s once stable)
   - Returns `{ status, loading, error, refresh }`

3. **Create `src/app/components/DeploymentStatusCard.tsx`**
   - Not deployed → PatternFly `EmptyState` with deploy button
   - Deploying → `Progress` component
   - Running → `DescriptionList` with health, URL, version
   - Error → `Alert` with retry and teardown buttons

4. **Create `src/app/components/DeployForm.tsx`**
   - Project selector (reuse `ProjectSelector`)
   - RBAC check display (reuse `useAccessReview`)
   - Deploy button (disabled if RBAC insufficient)
   - Confirmation modal

5. **Build `src/app/pages/InstanceManagementPage.tsx`** — replace placeholder:
   - Project selector at top
   - Conditional rendering by deployment state
   - Teardown confirmation modal with PVC data loss warning

6. **Create `src/app/types.ts`** — `SupersetStatus`, `SupersetDashboard`, `DeploymentState`

7. **Write tests** — hooks, page, and component spec files

8. **Validate** — `npm run lint && npm test` passes

**Dependencies**: Phase 1 (clean pages), Phase 5 (BFF deploy/status endpoints).
**Estimated effort**: 3 days.

---

### Phase 8: Frontend — Embedded Dashboards Page

**Goal**: Build the Embedded Dashboards page with inline dashboard viewing via `@superset-ui/embedded-sdk`.

**Deliverables**:

1. **Add dependency** — `npm install @superset-ui/embedded-sdk`

2. **Create `src/app/hooks/useSupersetDashboards.ts`**
   - Fetch dashboard list from BFF, returns `{ dashboards, loading, error, refresh }`

3. **Create `src/app/hooks/useSupersetGuestToken.ts`**
   - Returns a `fetchGuestToken` function for `embedDashboard()`'s callback
   - The SDK auto-calls this on token expiry

4. **Create `src/app/components/SupersetDashboardEmbed.tsx`**
   - Wraps `embedDashboard()` from the SDK in a React component
   - Props: `dashboardId`, `supersetDomain`, `namespace`
   - `useRef` for mount point, `useEffect` for SDK lifecycle
   - Config: `hideTitle: true`, `hideChartControls: false`, `filters: { expanded: false }`
   - Full-height iframe styling (100% width, 80vh height)

5. **Create `src/app/components/DashboardList.tsx`**
   - PatternFly `Card` grid showing dashboard title + status
   - Click → navigate to embedded view
   - Empty state with link to Superset UI

6. **Build `src/app/pages/EmbeddedDashboardsPage.tsx`** — replace placeholder:
   - Sub-routes: `/dashboards` (list) and `/dashboards/:id` (embed)
   - Project selector at top
   - Guard: if Superset not running, show message linking to Instance page
   - Toolbar on embed view: back button, refresh, fullscreen toggle, open-in-Superset

7. **Write tests** — hooks, components, and page spec files (mock the embedded SDK)

8. **Validate** — `npm run lint && npm test` passes

**Dependencies**: Phase 6 (BFF guest-token/dashboards endpoints), Phase 7 (status hook for guard check).
**Estimated effort**: 3 days.

---

### Phase 9: Helm Chart Updates & Deployment Infrastructure

**Goal**: Update the parent Helm chart, CI/CD, and deployment docs for the complete plugin.

**Deliverables**:

1. **Update `chart/values.yaml`** — full Superset config section, BFF env vars for Superset operations

2. **Update `chart/templates/bff-deployment.yaml`** — add environment variables for Superset admin credentials and sub-chart template path

3. **Update `chart/Chart.yaml`** — add sub-chart dependency (condition: `superset.enabled`)

4. **Update `plugin.yaml`** — Superset-specific description, RBAC requirements for deployment

5. **Update `package.json`** — description reflecting Superset plugin

6. **Verify webpack dev proxy** — confirm `/apache-superset/api/superset/*` routes correctly through existing proxy rule in `config/webpack.dev.js`

7. **Update deployment docs**:
   - `docs/deployment/OPENSHIFT_DEPLOY.md` — Superset-specific instructions, env vars, Secret setup
   - `docs/development/LOCAL_SETUP.md` — running Superset locally (docker run, admin bootstrap, BFF env vars)

8. **Validate** — `helm lint chart/`, `helm template chart/`, lint and tests all pass

**Dependencies**: Phases 3, 5, 6, 7, 8 (all code must be complete).
**Estimated effort**: 2 days.

---

### Phase 10: Testing, Polish & Documentation

**Goal**: End-to-end testing, UI polish, accessibility, and complete documentation.

**Deliverables**:

1. **Create integration test plan** — `docs/development/TESTING.md` with manual test scenarios:
   - Deploy → status → list dashboards → embed → teardown cycle
   - RBAC: verify deploy disabled without permissions
   - Error: deploy to namespace without quota, teardown while deploying

2. **UI polish**:
   - Loading skeletons (PatternFly `Skeleton`) on all data-loading views
   - Error boundaries around embedded dashboards
   - Responsive layout, tooltips, consistent iconography

3. **Accessibility** — `aria-label` on interactive elements, keyboard navigation, screen reader compatibility

4. **Update `AGENTS.md`** (symlinked as `CLAUDE.md`):
   - Remove all "planned" / "seed" references
   - Update Pages, Hooks, BFF, Dependencies sections to reflect implemented state

5. **Update `README.md`** — final overview, architecture diagram, updated quick start and dev instructions

6. **Final validation** — `npm run lint && npm test`, `cd bff && npm run lint && npm test`, `helm lint chart/`, all three images build successfully

**Dependencies**: All previous phases.
**Estimated effort**: 2 days.

---

## Summary

| Phase | Description | Dependencies | Effort |
|-------|-------------|-------------|--------|
| 1 | Clean Slate — Remove seed content, update routing | None | 1 day |
| 2 | Custom Superset Container Image | None | 1 day |
| 3 | Superset Helm Sub-Chart | Phase 2 | 3 days |
| 4 | BFF — SupersetClient & Core Infrastructure | Phases 1, 3 | 3 days |
| 5 | BFF — Deployment & Status Endpoints | Phase 4 | 3 days |
| 6 | BFF — Guest Token & Dashboard Listing Endpoints | Phases 4, 5 | 2 days |
| 7 | Frontend — Instance Management Page | Phases 1, 5 | 3 days |
| 8 | Frontend — Embedded Dashboards Page | Phases 6, 7 | 3 days |
| 9 | Helm Chart Updates & Deployment Infrastructure | Phases 3–8 | 2 days |
| 10 | Testing, Polish & Documentation | All | 2 days |
| **Total** | | | **23 days** |

### Parallelization Opportunities

- **Phases 1 and 2** can run fully in parallel (no file overlap)
- **Phase 3** can start as soon as Phase 2 provides the image name
- **Phase 4** can begin SupersetClient/types work once Phase 1 clears BFF types (helmRenderer piece needs Phase 3)
- **Phase 7** can start hook stubs and UI before Phase 5 endpoints are done (use mocked BFF responses)
- **Phases 9 and 10** can partially overlap

### Critical Path

```text
Phase 1 → Phase 4 → Phase 5 → Phase 6 → Phase 8 → Phase 9 → Phase 10
```

Phase 7 (Instance Management page) is **not** on the critical path — it can proceed in parallel with Phase 6 once Phase 5 is done.

---

## Open Questions & Future Considerations

1. **Helm template rendering approach**: The plan uses a simplified renderer in the BFF. Alternatives: bundle the `helm` CLI in the BFF container (~50MB) or pre-render templates at build time. Decision during Phase 4 implementation.

2. **Superset version upgrades**: Sub-chart pins to 4.1.1. Future: support in-place upgrades via `superset db upgrade`. V1 uses teardown-and-redeploy.

3. **Persistent dashboard configuration**: Tearing down destroys PostgreSQL PVC and all dashboards. Future: Superset's export/import API for asset backup.

4. **OIDC integration**: Optional Superset OIDC for direct UI access is deferred — guest tokens cover the primary embedding use case.

5. **Full mode (Redis + Celery)**: Lightweight mode only for v1. Full mode templates are gated by values in the sub-chart but not tested.

6. **Resource quotas**: The BFF could pre-check namespace quota before deployment. Deferred to a future enhancement.

7. **Dashboard auto-discovery**: Currently users create dashboards in Superset manually. Future: ship starter dashboards as importable JSON assets.

---

## Verification

After each phase, run:

```bash
npm run lint && npm test                    # Frontend
cd bff && npm run lint && npm test          # BFF
helm lint chart/ && helm template chart/    # Helm chart (Phases 3+)
```

The plan file will be saved to `docs/project/PROJECT_PLAN.md` once approved.
