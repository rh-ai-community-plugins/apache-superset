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

### Pages (Planned)

The plugin will have two main pages, routed under `/apache-superset/*`:

- **Instance Management page** — Deploy, monitor, and tear down the Superset instance. States: not deployed (with RBAC check), deploying (progress), running (health/status), error (retry/teardown).
- **Embedded Dashboards page** — Browse available Superset dashboards and embed them inline via `@superset-ui/embedded-sdk`. Uses guest tokens for scoped, identity-aware access.

Currently, the codebase still contains the seed project's demo pages (User Info, Cluster Resources, Namespace Summary). These will be replaced during implementation.

### Custom Hooks (Planned)

The following hooks will be implemented to support the Superset integration:

- `useSupersetDeployment` — Deploy/teardown/status via BFF
- `useSupersetStatus` — Health check polling
- `useSupersetDashboards` — List dashboards via BFF -> Superset API
- `useSupersetGuestToken` — Fetch guest tokens for embedding
- `useSupersetDataSources` — Manage data warehouse connections

Currently, the codebase contains the seed project's hooks (`useCurrentUser`, `useProjects`, `useFavoriteProjects`, `useK8sResources`, `useAccessReview`, `useNamespaceSummary`). Some will be retained (e.g., `useAccessReview` for RBAC checks), others replaced.

### BFF Service

The `bff/` directory contains a standalone Express.js + TypeScript backend service. For this plugin, the BFF will:

1. Deploy/manage Superset K8s resources (Deployments, Services, ConfigMaps, Secrets, PVCs)
2. Authenticate to the Superset REST API with admin credentials (from K8s Secret)
3. Generate scoped guest tokens for embedded dashboard access (mapping RHOAI user identity)
4. Proxy dashboard listing and data source management calls to the Superset API

The dashboard proxies requests from `/apache-superset/api/*` to this service, forwarding the user's Bearer token. See `docs/architecture/BFF_PATTERN.md` for the general BFF pattern and `docs/architecture/SUPERSET_PLUGIN_ARCHITECTURE.md` for the Superset-specific BFF design.

### Key Dependencies (Planned)

- `@superset-ui/embedded-sdk` — Official React SDK for embedding Superset dashboards via guest tokens

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
- **Helm chart**: `chart/` deploys to Kubernetes with Deployment + Service for both frontend and BFF. Frontend defaults to `quay.io/OWNER/apache-superset:latest`, BFF to `quay.io/OWNER/apache-superset-bff:latest`.
- **Superset instance**: Deployed on-demand by the BFF into the user's namespace. Lightweight mode: Superset (Gunicorn on port 8088) + PostgreSQL. Full mode adds Redis + Celery workers.

### CI/CD Workflows

- `.github/workflows/ci.yml` — Runs tests and lint for both frontend and BFF on push/PR to main.
- `.github/workflows/build-push.yml` — Builds and pushes both container images to Quay.io. Manually triggered via `workflow_dispatch` with a version input.

## Documentation

Project documentation lives under `docs/` in semantic subfolders:

```text
docs/architecture/   — Plugin system internals, BFF pattern, and Superset plugin architecture
docs/development/    — Local dev setup and dashboard API reference
docs/deployment/     — OpenShift deployment with Helm and dashboard registration
```

## Key Conventions

- Path alias: `~` maps to `./src` (webpack) and `@` maps to `./src` (jest). Use `~` in source code imports.
- UI components use **PatternFly 6** (`@patternfly/react-core`, `@patternfly/react-icons`).
- TypeScript strict mode is enabled. Target is ES2020 with ESNext modules and `react-jsx` transform.
- No standalone ESLint config file — uses `@typescript-eslint` defaults via dev dependencies.
