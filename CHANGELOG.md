# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-21

### Added

- **Instance Management page** — deploy, monitor, and tear down Apache Superset from the RHOAI Dashboard with RBAC-gated controls, deployment progress tracking, and a confirmation modal for teardown with data-loss warning
- **Embedded Dashboards page** — browse available Superset dashboards, embed them inline via `@superset-ui/embedded-sdk` guest tokens, with fullscreen toggle and direct links to the Superset UI
- **Load examples** — one-click loading of Superset's built-in example datasets and dashboards via WebSocket-based `kubectl exec`, with real-time log streaming in a modal
- **BFF (Backend For Frontend) service** — Express.js + TypeScript backend providing:
  - `POST /api/superset/deploy` — deploy Superset + PostgreSQL into a namespace via in-process Helm template rendering and K8s apply
  - `DELETE /api/superset/deploy` — teardown resources with optional force flag, respecting `helm.sh/resource-policy` annotations
  - `GET /api/superset/status` — deployment phase and Superset health aggregation
  - `GET /api/superset/config` — instance configuration (mode, version, embedding status)
  - `GET /api/superset/dashboards` — paginated dashboard list with per-dashboard embedded ID resolution
  - `GET /api/superset/guest-token` — scoped guest token generation with CSRF token flow and user identity mapping
  - `POST /api/superset/load-examples` — trigger `superset load-examples` via WebSocket exec with streaming output
  - `GET /api/health` — unauthenticated health check
- **Helm chart** (`chart/`) — deploys frontend (Nginx) and BFF (Node.js) with Deployment + Service for each; includes a `charts/superset/` sub-chart for on-demand Superset instances (Superset + PostgreSQL + init containers for schema migration, admin creation, and EmbedGuest role setup)
- **Nonroot Superset container image** — UBI9-based Apache Superset 4.1.1 image running as non-root (UID 1001) with custom `superset_config.py` and embedded dashboard support (`Containerfile.superset`)
- **Authentication bridging** — OpenShift user identity mapped to Superset guest tokens via the BFF; no separate Superset login required
- **EmbedGuest role auto-provisioning** — init container creates a dedicated `EmbedGuest` role with scoped read permissions for embedded dashboard access
- **Module Federation integration** — exposes `./extensions` and `./Icon` remote modules for the RHOAI dashboard host application
- **Project selector** — shared project dropdown with localStorage-backed favorites and last-selected project memory across pages
- **Adaptive status polling** — 10-second intervals while deploying, 30-second intervals when stable
- **CI/CD workflows** — GitHub Actions for test/lint on push/PR (`ci.yml`) and container image build/push to Quay.io (`build-push.yml`)
- **Build tooling** — `scripts/build-push.sh` for multi-image builds, `scripts/scan-image.sh` for Trivy vulnerability scanning, `scripts/sync-chart-version.js` for version synchronization across packages
- **Makefile** — unified targets for install, lint, typecheck, test, build, dev servers, container image operations, and Helm chart packaging across frontend and BFF
- **User Guide** — end-user documentation covering deployment, example data loading, dashboard embedding configuration, and teardown
