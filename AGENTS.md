# AGENTS.md

This file provides guidance to AI coding agents working with code in this repository.

## Project Overview

This is `apache-superset`, a community plugin for the **Red Hat OpenShift AI (RHOAI) Dashboard** that deploys Apache Superset on-demand and embeds Superset dashboards inline within the dashboard UI. It uses Webpack 5 Module Federation to expose remote modules that the RHOAI dashboard host application loads at runtime.

### Goals

1. **Deploy Apache Superset on-demand** into a user's OpenShift project (lightweight mode: Superset + PostgreSQL, 2 pods)
2. **Embed Superset dashboards** inline within the RHOAI Dashboard using the official `@superset-ui/embedded-sdk`
3. **Bridge authentication** so the RHOAI Dashboard user's identity is passed through to Superset via guest tokens

The full architecture is documented in `docs/architecture/SUPERSET_PLUGIN_ARCHITECTURE.md`.

## Build & Development Commands

```bash
npm run start:dev     # Dev server on port 9500 with HMR
npm run build         # Production build to dist/
npm test              # Run all tests (Jest + jsdom)
npm run test:watch    # Watch mode
npm run test:coverage # Tests with coverage report
npm run lint          # ESLint on src/ + markdownlint on **/*.md
```

To run a single test file:

```bash
npx jest src/app/hooks/useCurrentUser.test.ts
```

### BFF Service Commands

```bash
cd bff
K8S_API_BASE=$(oc whoami --show-server) npm run start:dev  # Dev server on port 3000 (K8S_API_BASE required for local dev)
npm run build         # Compile TypeScript to dist/
npm start             # Run compiled server (in-cluster, K8S_API_BASE not needed)
npm test              # Run BFF tests (Jest + node)
npm run lint          # ESLint on bff/src/
```

## Architecture

### Module Federation Plugin System

The plugin exposes two remote modules to the RHOAI dashboard host via Webpack Module Federation (configured inline in `config/webpack.common.js`):

- **`./extensions`** (`src/rhoai/extensions.ts`) — Defines extension points for the plugin's feature area, navigation sections, nav items, and route
- **`./Icon`** (`src/app/components/ApacheSupersetNavIcon.tsx`) — SVG icon for the plugin's nav subsection. A separate `CommunityNavIcon.tsx` provides the icon for the shared `community-plugins` parent section.

Shared singletons (react, react-dom, react-router-dom, @patternfly/react-core, @openshift/dynamic-plugin-sdk) are provided by the host and not bundled into the plugin.

### Pages

The plugin has two pages, routed under `/apache-superset/*`:

- **Instance Management page** (`src/app/pages/InstanceManagementPage.tsx`) — Deploy, monitor, and tear down the Superset instance. States: not deployed (with RBAC check), deploying (progress bar), running (health/status/version), error (retry/teardown). Uses a confirmation modal for teardown with data-loss warning.
- **Embedded Dashboards page** (`src/app/pages/EmbeddedDashboardsPage.tsx`) — Browse available Superset dashboards and embed them inline via `@superset-ui/embedded-sdk`. Supports fullscreen toggle, back navigation, and links to the Superset UI. Shows a "not running" state with link to Instance Management when Superset is not deployed.

### Hooks

**Superset-specific hooks:**

- `useSupersetDeployment` — Deploy and teardown via BFF. Returns `deploy()`, `teardown()`, loading states, and error.
- `useSupersetStatus` — Polls BFF for deployment status with adaptive intervals (10s while deploying, 30s when stable). Returns `status`, `loading`, `error`, `refresh()`.
- `useSupersetDashboards` — Fetches dashboard list from BFF. Returns `dashboards[]`, `loading`, `error`, `refresh()`.
- `useSupersetGuestToken` — Returns a `() => Promise<string>` callback for fetching scoped guest tokens for dashboard embedding.
- `useLoadExamples` — Triggers `superset load-examples` via BFF, streams real-time log output over SSE. Returns `start()`, `status`, `logs`, and `error`.

**Infrastructure hooks:**

- `useAccessReview` — SelfSubjectAccessReview checks for RBAC gating on the deploy form.
- `useProjects` — Fetches OpenShift project list for the project selector.
- `useFavoriteProjects` — localStorage-backed project favorites.
- `useLastSelectedProject` — localStorage-backed project memory, shared across pages.
- `useCurrentUser` — Fetches `/api/status` for user identity (available but not currently used by any page).

### BFF Service

The `bff/` directory contains a standalone Express.js + TypeScript backend service that provides:

1. **Deploy/teardown** — Renders Helm templates in-process and applies/deletes Superset K8s resources (Deployments, Services, ConfigMaps, Secrets, PVCs, ServiceAccounts, Routes)
2. **Status monitoring** — Checks Deployment readiness and Superset `/health` endpoint, returns aggregated phase
3. **Guest token generation** — Authenticates to Superset REST API with admin credentials (from K8s Secret), maps RHOAI user identity to scoped guest tokens
4. **Dashboard listing** — Proxies paginated dashboard list from Superset API with embeddedId resolution
5. **Instance configuration** — Returns deployment mode, version, and embedding status
6. **Load examples** — Executes `superset load-examples` inside the Superset pod via K8s exec WebSocket, streaming stdout/stderr back to the frontend

API routes (all require Bearer token via auth middleware):

- `POST /api/superset/deploy` — Deploy Superset into a namespace
- `DELETE /api/superset/deploy` — Teardown resources (with optional `force` flag)
- `GET /api/superset/status` — Check deployment phase and health
- `GET /api/superset/config` — Get instance configuration
- `GET /api/superset/dashboards` — List dashboards (paginated)
- `GET /api/superset/guest-token` — Generate embedding guest token
- `POST /api/superset/load-examples` — Trigger `superset load-examples` via WebSocket exec with streaming output
- `GET /api/health` — Health check (no auth)

The dashboard proxies requests from `/apache-superset/api/*` to this service, forwarding the user's Bearer token. See `docs/architecture/BFF_PATTERN.md` for the general BFF pattern and `docs/architecture/SUPERSET_PLUGIN_ARCHITECTURE.md` for the Superset-specific BFF design.

### Key Dependencies

- `@superset-ui/embedded-sdk` — Official React SDK for embedding Superset dashboards via guest tokens
- `@patternfly/react-core`, `@patternfly/react-icons`, `@patternfly/react-table` — PatternFly 6 UI components
- `express`, `js-yaml` — BFF server and Helm template YAML parsing
- `ws` — WebSocket client for K8s exec API (used by load-examples to stream command output from pods)

### Entry Point Chain

`src/index.ts` → dynamic import → `src/bootstrap.tsx` (React 18 root render). The dynamic import is required for Module Federation to resolve shared dependencies before the app renders.

### Plugin Registration

`plugin.yaml` at the repo root is a unified flat manifest that serves both as the Module Federation runtime config (consumed by the RHOAI dashboard) and the community plugin catalog metadata (consumed by the charter registry). It declares plugin identity, maintainer, RHOAI version compatibility, deployment model, container image, install method (automatic/assisted/manual with Helm registry and prerequisites), Module Federation remote entry and routes, RBAC requirements, and support links.

### Webpack Configs

- `config/webpack.common.js` — Shared config: entry point, loaders, Module Federation, path alias `~` → `./src`
- `config/webpack.dev.js` — Dev server on port 9500, proxies `/apache-superset/api` to BFF at `localhost:3000` and `/apache-superset` to dashboard at `localhost:8443`
- `config/webpack.prod.js` — Output to `dist/`, CSS extraction, vendor chunk splitting

### Test Setup

Jest with `ts-jest` preset and `jsdom` environment (`jest.config.js`). `jest.setup.tsx` mocks `react-router-dom` (useNavigate, useParams, useLocation, Outlet, Routes, Route, Navigate) and polyfills TextEncoder/TextDecoder. CSS modules are proxied to return property names as class names (`jest.style-mock.js`).

### Scripts

- `scripts/build-push.sh` — Builds and pushes container images (frontend, BFF, or both) to Quay.io. Auto-computes the next version from git tags if not provided.
- `scripts/scan-image.sh` — Builds container images locally and scans them for vulnerabilities using Trivy.
- `scripts/sync-chart-version.js` — Syncs the version from root `package.json` into `chart/Chart.yaml`, `bff/package.json`, and `plugin.yaml` (both `version` and `image.tag`). Runs automatically via npm's `version` lifecycle hook.

### Deployment

- **Frontend container**: Multi-stage build in `Containerfile` — UBI9 Node 22 builder → UBI9 Nginx 1.24 serving `dist/` on port 8080 as UID 1001. Nginx adds CORS header on `remoteEntry.js`.
- **BFF container**: Multi-stage build in `bff/Containerfile` — UBI9 Node 22 builder → UBI9 Node 22 runtime on port 3000 as UID 1001.
- **Helm chart**: `chart/` deploys the plugin to Kubernetes with Deployment + Service for both frontend and BFF. Includes a `charts/superset/` sub-chart with templates for the on-demand Superset instance (Deployment, Service, ConfigMap, Secret, Route, PVC, ServiceAccount for both Superset and PostgreSQL). The sub-chart is rendered in-process by the BFF's helmRenderer, not installed by Helm directly.
- **Superset instance**: Deployed on-demand by the BFF into the user's namespace. Lightweight mode: Superset (Gunicorn on port 8088) + PostgreSQL. Full mode adds Redis + Celery workers.

### CI/CD Workflows

- `.github/workflows/ci.yml` — Runs tests and lint for both frontend and BFF on push/PR to main.
- `.github/workflows/build-push.yml` — Builds and pushes both container images to Quay.io. Manually triggered via `workflow_dispatch` with a version input.

## Documentation

Project documentation lives under `docs/` in semantic subfolders:

```text
docs/architecture/   — Plugin system internals, BFF pattern, and Superset plugin architecture
docs/development/    — Local dev setup, dashboard API reference, and integration test plan
docs/deployment/     — OpenShift deployment with Helm and dashboard registration
docs/project/        — Implementation project plan (historical reference)
```

## Development Best Practices

`docs/development/BEST_PRACTICES.md` contains patterns and a pre-PR checklist derived from post-implementation fixes. Key rules:

- **BFF routes**: Use runtime auth guards (never `req.token!`), validate all inputs at boundaries, sanitize K8s error bodies before returning to clients, add `.catch()` to every promise chain, include pagination metadata on list endpoints.
- **React hooks**: Cleanup must use `ref.current` not closure-captured variables; key error boundaries by navigation params; keep `aria-live` regions narrow; add `screenreaderText` to Skeleton components.
- **Helm templates**: Cast numeric values with `| int`; test `trunc` length with max-length release names; add `helm.sh/resource-policy: keep` to stateful resources (PVCs, Secrets); ensure label selectors in code match rendered template labels.
- **Security**: Validate paths with `startsWith()` on resolved paths (never `includes()`); validate CORS port ranges; never expose raw internal error bodies.
- **Cross-component contracts**: Test label selectors against rendered Helm output; assert API response shapes in both producer and consumer tests; handle status/phase enums exhaustively in the frontend.

## Key Conventions

- Path alias: `~` maps to `./src` (webpack) and `@` maps to `./src` (jest). Use `~` in source code imports.
- UI components use **PatternFly 6** (`@patternfly/react-core`, `@patternfly/react-icons`).
- TypeScript strict mode is enabled. Target is ES2020 with ESNext modules and `react-jsx` transform.
- No standalone ESLint config file — uses `@typescript-eslint` defaults via dev dependencies.
