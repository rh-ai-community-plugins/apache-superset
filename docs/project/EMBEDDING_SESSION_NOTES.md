# Embedded Dashboards — Session Notes (2026-07-20)

## Goal

Enable Superset dashboard embedding in the plugin so dashboards show as "Embeddable" and render inline via the `@superset-ui/embedded-sdk`.

## Findings

### 1. Superset API does not expose `embedded` on the dashboard list endpoint

The `GET /api/v1/dashboard/` endpoint does not include the `embedded` relationship in its default `list_columns`. Requesting it via the Rison `columns` parameter is silently ignored.

**Fix applied:** `listDashboards()` in `bff/src/utils/supersetClient.ts` now calls `GET /api/v1/dashboard/{id}/embedded` per dashboard in parallel to resolve each `embeddedId`. Returns the UUID if configured, `undefined` (with a 404 catch) if not.

### 2. Guest token endpoint requires CSRF token

The `POST /api/v1/security/guest_token/` endpoint requires a valid CSRF token + session cookie, even when authenticated with a bearer token. The `WTF_CSRF_EXEMPT_LIST` with blueprint name `"superset.security.api"` does not exempt this endpoint.

**Fix applied:** `generateGuestToken()` now implements a two-step flow:

1. `GET /api/v1/security/csrf_token/` — fetches CSRF token and captures `Set-Cookie` session header
2. `POST /api/v1/security/guest_token/` — sends `X-CSRFToken` header and `Cookie` header alongside the bearer token

This required adding a raw `fetchCsrfToken()` method using `http`/`https` directly (since `httpRequest` doesn't expose response headers).

### 3. BFF should use in-cluster service URL, not the Route

The BFF was resolving the Superset URL by preferring the OpenShift Route (external HTTPS, TLS-terminated). This caused "socket hang up" errors because the BFF's requests went out through the external ingress and back in.

**Fix applied:** `getSupersetUrl()` in `bff/src/utils/secretReader.ts` now always returns the in-cluster service URL (`http://superset-superset-svc.<ns>.svc.cluster.local:8088`). The Route URL is still used by `supersetConfig.ts` to provide the external URL to the frontend for the iframe domain and "Open in Superset" links.

### 4. Public role must not be used as the guest role

Setting `GUEST_ROLE_NAME = "Public"` and adding permissions to the Public role causes the admin user's dashboard list API to return zero results. The Public role is special in Superset and modifying it has side effects on all users.

**Fix applied:**

- `superset_config.py` in the ConfigMap now sets `GUEST_ROLE_NAME = "EmbedGuest"`
- A new `init-embed-role.py` script in the ConfigMap is executed by the init container after `superset init`
- The script creates the `EmbedGuest` role (idempotent) and grants it the required permissions:
  - `can_read` on `Dashboard`, `Chart`, `Dataset`, `EmbeddedDashboard`
  - `can_explore` and `can_explore_json` on `Superset`

### 5. Per-dashboard embedding must be enabled in the Superset UI

The `EMBEDDED_SUPERSET: True` feature flag (already set by the Helm chart) enables the embedding feature globally, but each dashboard must be individually configured:

- Dashboard → three-dot menu → "Embed dashboard"
- Enter the RHOAI Dashboard origin in "Allowed domains"

## Current State

### What works

- Dashboard list endpoint returns dashboards with correct `embeddedId` resolution
- CSRF token flow for guest token generation is implemented
- BFF uses in-cluster service URL for Superset API calls
- Helm chart templates updated for `EmbedGuest` role auto-creation

### What needs testing

- The `EmbedGuest` role has not been tested end-to-end yet — the role needs to be created (either via teardown+redeploy or manually in Superset UI) and the embedded dashboard iframe needs to be verified
- The 403 Forbidden on the embedded iframe (`/embedded/{uuid}`) may need additional permissions on the `EmbedGuest` role (e.g., `can_read on CurrentUserRestApi` exists in Superset 6.x but not 4.1.1)

## Next Steps

1. **Create the `EmbedGuest` role and test embedding end-to-end:**
   - Option A: Teardown and redeploy from the plugin (init container will create the role automatically)
   - Option B: Manually create the role in Superset UI with the permissions listed above, update the ConfigMap's `GUEST_ROLE_NAME` to `"EmbedGuest"`, restart the Superset pod
   - Then: enable embedding on a dashboard, click it in the plugin, verify the iframe renders

2. **If 403 persists on the embedded iframe**, investigate which additional permissions the `EmbedGuest` role needs for Superset 4.1.1. Check the Superset pod logs for the specific permission denial. Candidates:
   - `can_time_range` on `Api` (if dashboards use time filters)
   - Other `can_read` permissions specific to 4.x

3. **Clean up debug logging** once embedding works:
   - Remove `[DEBUG]` and `[DEBUG-DASHBOARDS]` console.log lines from `bff/src/utils/supersetClient.ts` and `bff/src/routes/supersetDashboards.ts`
   - Remove `[DEBUG BUILD]` tag from `bff/src/server.ts`
   - Remove `Cache-Control: no-store` header from dashboards route
   - Remove `responseBody` from the `makeError` callback in `supersetClient.ts` (or keep it — it's useful for diagnostics)

4. **Consider caching for `getDashboardEmbeddedId`** — currently makes N extra HTTP calls per dashboard list request. Options:
   - Cache embedded IDs with a short TTL (30-60s)
   - Accept the overhead since the calls are parallel and fast on the in-cluster network

## Files Modified

| File | Change |
|------|--------|
| `bff/src/utils/supersetClient.ts` | New CSRF flow, per-dashboard embedded ID fetch, response body in errors |
| `bff/src/utils/secretReader.ts` | Always use in-cluster service URL |
| `bff/src/routes/supersetDashboards.ts` | Debug logging (to be removed) |
| `bff/src/server.ts` | Debug tag (to be removed) |
| `bff/__tests__/supersetClient.test.ts` | Updated for CSRF flow and per-dashboard embedded mocks |
| `bff/src/__tests__/utils/secretReader.test.ts` | Updated to expect service URL over Route |
| `chart/charts/superset/templates/superset-configmap.yaml` | `EmbedGuest` role name, `init-embed-role.py` script |
| `chart/charts/superset/templates/superset-deployment.yaml` | Init container runs `init-embed-role.py` |
