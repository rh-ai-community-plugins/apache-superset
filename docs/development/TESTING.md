# Integration Test Plan

Manual integration test scenarios for the Apache Superset community plugin.

## Prerequisites

- OpenShift cluster with RHOAI Dashboard installed
- Plugin deployed via Helm chart (`helm install apache-superset chart/ -n apache-superset --create-namespace`)
- Plugin registered with the RHOAI Dashboard (see [OPENSHIFT_DEPLOY.md](../deployment/OPENSHIFT_DEPLOY.md))
- `oc` CLI authenticated to the cluster
- At least two test users:
  - **admin-user** — cluster-admin or namespace admin with full RBAC
  - **viewer-user** — read-only access to the target namespace (no create/delete on deployments, services, configmaps, secrets)

## Running Automated Tests

```bash
# Frontend unit tests
npm test
npm run test:coverage

# BFF unit tests
cd bff && npm test

# Lint (both)
npm run lint
cd bff && npm run lint
```

## Test Scenarios

### 1. Full Lifecycle (Happy Path)

#### T-001 Deploy, monitor, browse dashboards, embed, and teardown

Preconditions: Logged in as admin-user. No Superset instance in the target namespace.

Steps:

1. Navigate to **Instance Management** page.
2. Select a project from the project selector.
3. Verify the RBAC permissions list shows all green checkmarks.
4. Click **Deploy Superset** and confirm in the modal.
5. Observe the deploying state with progress bar.
6. Wait for status to change to **running** with version and URL displayed.
7. Navigate to **Dashboards** page.
8. Verify the same project is pre-selected (persisted via localStorage).
9. If no dashboards exist, click **Open Superset** to access the Superset UI directly.
10. Create a dashboard in Superset and enable embedding on it.
11. Return to the plugin Dashboards page and click **Refresh**.
12. Click a dashboard with an "Embeddable" label.
13. Verify the dashboard renders inline via the embedded SDK.
14. Toggle **Fullscreen** and verify the overlay expands.
15. Click **Exit fullscreen** and verify normal layout restores.
16. Click **Back** to return to the dashboard list.
17. Navigate to **Instance Management** and click **Tear down**.
18. Confirm in the modal. Verify resources are deleted.

Expected: Full lifecycle completes without errors. Status transitions smoothly through all phases. Dashboard embeds successfully with guest token authentication.

### 2. RBAC Verification

#### T-010 Deploy disabled without create permissions

Preconditions: Logged in as viewer-user with read-only namespace access.

Steps:

1. Navigate to **Instance Management**.
2. Select the target project.
3. Observe the permissions list.

Expected: Red X icons appear next to resources the user cannot create. **Deploy Superset** button is disabled.

#### T-011 Teardown blocked without delete permissions

Preconditions: Superset is running. Logged in as viewer-user.

Steps:

1. Navigate to **Instance Management**.
2. Select the project with the running instance.
3. Click **Tear down** and confirm.

Expected: The BFF returns a 403 error. An error alert is displayed. Resources remain intact.

### 3. Error Scenarios

#### T-020 Deploy when namespace has insufficient resource quota

Preconditions: Target namespace has a ResourceQuota that prevents creating new pods.

Steps:

1. Select the quota-limited project.
2. Click **Deploy Superset** and confirm.

Expected: Deployment starts but transitions to **error** phase. The status card shows the error message from the K8s API (quota exceeded). Retry and Tear down buttons are available.

#### T-021 Teardown while deploying

Preconditions: Superset deployment is in progress (deploying phase).

Steps:

1. While the progress bar is showing, reload the page so status shows the partially-deployed resources.
2. If the status shows deploying or error, attempt to tear down.

Expected: Teardown removes partially-created resources. Status returns to not-deployed.

#### T-022 BFF unreachable

Preconditions: Scale the BFF deployment to 0 replicas: `oc scale deploy apache-superset-bff -n apache-superset --replicas=0`

Steps:

1. Navigate to **Instance Management** and select a project.
2. Attempt to deploy.

Expected: Network error displayed. The page does not crash. Restore BFF replicas and verify recovery.

#### T-023 Superset health check failure

Preconditions: Superset is deployed. Kill the Superset process inside the pod (or scale Superset deployment to 0).

Steps:

1. Navigate to **Instance Management**.
2. Observe the status card.

Expected: Status shows **error** or **deploying** phase (not running). The health indicator reflects the unhealthy state. After restoring the pod, status returns to running on the next poll cycle.

#### T-024 Expired or invalid guest token during embedding

Preconditions: A dashboard is embedded and rendering.

Steps:

1. Wait for the guest token to expire (default: 300 seconds / 5 minutes) or invalidate it by restarting Superset.
2. Observe the embedded dashboard behavior.

> **Note:** The guest token TTL is configured via `GUEST_TOKEN_JWT_EXP_SECONDS` in
> the Superset ConfigMap (`superset_config.py`). The Helm sub-chart sets this from
> `embedding.guestTokenExpSeconds` in `chart/charts/superset/values.yaml`
> (default: `300`). It can also be overridden at runtime via the
> `SUPERSET_GUEST_TOKEN_JWT_EXP_SECONDS` environment variable on the Superset pod.
> To shorten the wait during testing, set the value to a lower number (e.g., `30`)
> before deploying.

Expected: The embedded SDK requests a fresh token via `fetchGuestToken`. If the refresh succeeds, the dashboard continues rendering. If it fails, an error alert is displayed.

### 4. UI State Transitions

#### T-030 Loading states display correctly

Preconditions: Plugin is accessible.

Steps:

1. Navigate to Instance Management — observe loading skeleton while status is fetched.
2. Navigate to Dashboards with a running Superset — observe loading skeleton while dashboards load.
3. Click a dashboard — observe loading while the embed initializes.

Expected: Content-shaped loading skeletons appear during async operations. No layout shift when content loads.

#### T-031 Project selector persistence

Preconditions: Multiple projects available.

Steps:

1. On Instance Management, select project "alpha".
2. Navigate to Dashboards page.
3. Verify "alpha" is pre-selected.
4. Select project "beta" on Dashboards.
5. Navigate back to Instance Management.
6. Verify "beta" is pre-selected.

Expected: Last-selected project persists across page navigations and page reloads (stored in localStorage).

#### T-032 Error alerts clear on successful retry

Preconditions: A deploy or teardown operation has failed with a visible error alert.

Steps:

1. Fix the underlying issue (e.g., restore BFF, fix quota).
2. Click **Retry**.

Expected: Error alert clears when the retry starts. New status is displayed after the operation completes.

### 5. Cross-Page Navigation

#### T-040 Not-running redirect from Dashboards page

Preconditions: No Superset instance deployed.

Steps:

1. Navigate to **Dashboards** page and select a project.
2. Observe the empty state message.

Expected: "Superset is not running" message with a **Go to Instance Management** button. Clicking it navigates to the Instance Management page.

#### T-041 Back button from embedded view

Preconditions: A dashboard is embedded and rendering.

Steps:

1. Click the back arrow button in the toolbar.

Expected: Returns to the dashboard list view. The dashboard list is still populated (no re-fetch flicker).

### 6. BFF Health and Resilience

#### T-050 Health endpoint

Steps:

1. `curl https://<bff-route>/api/health`

Expected: Returns `{"status":"ok"}` with HTTP 200. No authentication required.

#### T-051 Invalid bearer token

Steps:

1. `curl -H "Authorization: Bearer invalid-token" https://<bff-route>/api/superset/status?namespace=test`

Expected: K8s API rejects the token. BFF returns an appropriate error (401 or 403). The raw K8s error body is not forwarded to the client.

#### T-052 Missing namespace parameter

Steps:

1. `curl -H "Authorization: Bearer $TOKEN" https://<bff-route>/api/superset/deploy` (POST with empty body)

Expected: BFF returns 400 with a validation error message.
