# Development Best Practices

Common pitfalls and patterns derived from post-implementation review of this plugin. These apply broadly to RHOAI Dashboard community plugins, especially those using the BFF pattern or Helm-based deployment.

---

## BFF Endpoint Development

### Authentication Guards

Never use TypeScript non-null assertions (`req.token!`) on auth-derived values. The auth middleware may not run on every route, and `!` turns a missing-token bug into a runtime crash instead of a 401.

```typescript
// Bad — crashes if middleware is missing or misconfigured
const token = req.token!;

// Good — explicit guard with proper HTTP status
const token = req.token;
if (!token) {
  return res.status(401).json({ message: 'Missing authentication token' });
}
```

### Input Validation at Route Boundaries

Validate every value that crosses a system boundary: query parameters, request bodies, URL path segments, and environment variables. Common misses:

- **Port numbers**: Validate range (1--65535). Without this, port 0 or 65536 passes CORS checks.
- **String values used in URIs**: Special characters in passwords or identifiers break connection strings. Validate the character set or encode properly.
- **Empty arrays**: `Array.every()` on an empty array returns `true`. Guard against vacuously-true permission checks:

```typescript
// Bad — returns true when results is empty, bypassing RBAC
const hasPermission = results.every((r) => r.status?.allowed);

// Good — empty means "no data yet", not "all allowed"
const hasPermission = results.length > 0 && results.every((r) => r.status?.allowed);
```

### Error Handling

1. **Never swallow errors with `|| true` or empty catches.** If a shell command can fail in multiple ways, catch the specific safe-to-ignore case:

   ```bash
   # Bad — hides database failures
   superset fab create-admin || true

   # Good — only ignore "already exists"
   superset fab create-admin 2>&1 | grep -q "already exists" || superset fab create-admin
   ```

2. **Always `.catch()` promises** — especially third-party SDK calls like `embedDashboard()`. An uncaught rejection shows nothing to the user.

3. **Sanitize error bodies before returning to clients.** Kubernetes API errors contain internal cluster details (resource versions, namespace paths, IP addresses). Wrap them:

   ```typescript
   // Bad — leaks cluster internals
   res.status(err.statusCode).json(err.body);

   // Good — return only the message
   res.status(err.statusCode).json({ message: err.body?.message || 'Request failed' });
   ```

4. **Separate error categories.** Don't conflate credential-read failures with user-identity failures in a single catch block — they need different HTTP status codes and error messages.

### Pagination

Add pagination support to list endpoints from the start, even if the initial dataset is small. Return `{ items, count, page, pageSize }` instead of a bare array. Retrofitting pagination is a breaking API change.

### HTTP Client Type Safety

When writing generic HTTP request functions (`k8sRequest<T>`, `httpRequest<T>`), handle empty response bodies explicitly. A 204 No Content or a plain-text health endpoint will produce `undefined`, which TypeScript silently casts to `T`:

```typescript
// Bad — undefined silently becomes T
return await response.json() as T;

// Good — explicit empty-body handling
if (response.status === 204 || contentLength === '0') {
  return undefined;
}
const body = await response.text();
return opts?.lenientJson ? body as unknown as T : JSON.parse(body) as T;
```

---

## React Hooks and Components

### Cleanup Must Use Refs, Not Closure Variables

When a hook has a refresh or retry mechanism, the cleanup function captures stale closure variables. Use a ref so cleanup always operates on the current value:

```typescript
// Bad — aborts the controller that existed when the effect first ran
useEffect(() => {
  const controller = new AbortController();
  fetchData(controller.signal);
  return () => controller.abort();
}, [dep]);

// Good — always aborts the latest controller
const controllerRef = useRef<AbortController>();
useEffect(() => {
  controllerRef.current?.abort();
  controllerRef.current = new AbortController();
  fetchData(controllerRef.current.signal);
  return () => controllerRef.current?.abort();
}, [dep]);
```

### Key Error Boundaries by Navigation Params

An error boundary that wraps a parameterized view (e.g., embedded dashboard by ID) must be keyed by that parameter. Otherwise, navigating from one errored item to another doesn't reset the error state:

```tsx
<EmbedErrorBoundary key={dashboardId}>
  <SupersetDashboardEmbed id={dashboardId} />
</EmbedErrorBoundary>
```

### Accessibility

- **Narrow `aria-live` regions.** Wrapping an entire `PageSection` with `aria-live="polite"` causes screen readers to re-announce the full DOM subtree on every status change. Limit it to the text element that actually changes.
- **Add `screenreaderText` to Skeleton components.** PatternFly skeletons are invisible to screen readers without this prop.
- These are easy to miss in development and hard to catch without an accessibility audit. Check screen reader behavior whenever adding loading states or dynamic status text.

### PatternFly Conventions

- Use PatternFly utility classes (`pf-v6-u-mt-md`) instead of inline `style={{ marginTop: ... }}`. Inline styles bypass the design system's spacing scale and don't respond to theme changes.
- Use accurate action labels. A button labeled "Retry failed" is confusing when shown on an initial deploy failure — label it by what it does ("Deploy request failed"), not by when it appears.

---

## Helm Chart Templates

### Type Coercion

Helm template values are strings by default. Ports, replica counts, and other numeric fields must be explicitly cast:

```yaml
# Bad — renders as string, may cause type errors in the workload
port: {{ .Values.port }}

# Good — explicit int cast
port: {{ .Values.port | int }}
```

### Name Truncation

The `trunc` function in `_helpers.tpl` can silently break names. If a release name is long, `trunc 63` on a fullname may clip a suffix like `-postgres`, causing name collisions between the main workload and its database:

```yaml
# Bad — clips to 63 chars, may lose the -postgres suffix
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}

# Good — leave room for the longest suffix
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 50 | trimSuffix "-" }}
```

Test with release names near the max length to verify uniqueness.

### Resource Policy Annotations

Stateful resources (PVCs, Secrets with generated credentials) should carry the `helm.sh/resource-policy: keep` annotation so they survive `helm uninstall` and teardown operations. Without this, users lose data:

```yaml
metadata:
  annotations:
    helm.sh/resource-policy: keep
```

Teardown code must check for and respect this annotation rather than blindly deleting all label-matched resources.

### Value Validation

Add comments in `values.yaml` documenting constraints (e.g., "alphanumeric only" for passwords used in database URIs, port range 1--65535). Helm does not validate values at install time; documenting constraints helps users and catches issues in code review.

### Label Selector Consistency

The label selectors used in teardown/status-check code must exactly match the labels rendered by Helm templates. A teardown that selects `app.kubernetes.io/part-of=superset` will miss resources that Helm also labels with `app.kubernetes.io/instance=<release>`. Test both directions: from labels to selector, and from selector to rendered resources.

---

## Security

### Path Validation

Use `startsWith()`, never `includes()`, for path validation. `includes('charts/')` matches an attacker-controlled path like `../../../etc/passwd/charts/`:

```typescript
// Bad — substring match, trivially bypassed
if (!filePath.includes('charts/')) throw new Error('Invalid path');

// Good — prefix match against resolved base
const resolved = path.resolve(filePath);
if (!resolved.startsWith(baseDir)) throw new Error('Path traversal detected');
```

### CORS Origin Validation

Validate the full origin, including port ranges. A regex like `/^https?:\/\/localhost(:\d+)?$/` accepts port 0 and port 99999. Add explicit port range checks (1--65535).

### Error Body Exposure

Never forward raw error objects from internal services (Kubernetes API, database, upstream APIs) to HTTP clients. They contain IP addresses, resource paths, and version strings that aid attackers. Extract only the `message` field.

### Auth Middleware Coverage

Verify that every route requiring authentication actually has the auth middleware applied. A single route missing middleware turns a 401 into a crash (when code tries to read the token) or into an unauthenticated backdoor. Consider a test that asserts all non-health routes require a Bearer token.

---

## Cross-Component Contract Testing

Integration bugs are the hardest to catch in unit tests because each component works correctly in isolation but fails when connected. Common contract mismatches:

1. **Label selectors vs. rendered labels.** Write a test that renders Helm templates and verifies the teardown/status code's label selector matches the output.
2. **API response shapes.** If the BFF returns `{ items, count, page }`, the frontend hook must expect all three fields. Assert the shape in both the BFF route test and the frontend hook test.
3. **Status values.** If the BFF returns a `phase` enum (`not-deployed`, `deploying`, `running`, `error`), the frontend must handle all values. A magic string comparison (`status === 'not found'`) breaks when the BFF changes to a structured flag.
4. **Auth token flow.** The dashboard forwards `Authorization: Bearer <token>` to the BFF. The BFF extracts it and uses it for K8s API calls. Test this chain end-to-end — a missing `authorize: true` in the proxy config silently drops the token.

---

## Pre-PR Checklist

Before opening a pull request, verify:

### BFF Routes

- [ ] Auth token is checked with a runtime guard, not a `!` assertion
- [ ] All query/body parameters are validated (type, range, required vs. optional)
- [ ] Error responses are sanitized — no raw K8s/upstream error bodies
- [ ] Every async operation has a `.catch()` or is inside a try/catch
- [ ] List endpoints return pagination metadata (`count`, `page`, `pageSize`)

### Frontend

- [ ] Hook cleanup uses `ref.current`, not closure-captured variables
- [ ] Error boundaries are keyed by the varying parameter (e.g., dashboard ID)
- [ ] `aria-live` regions wrap only the changing text, not a full section
- [ ] Skeleton/loading components have `screenreaderText`
- [ ] PatternFly utility classes used instead of inline styles
- [ ] Empty-array edge cases handled (no vacuously-true checks)

### Helm Charts

- [ ] Numeric values use `| int` (or `| float64`) in templates
- [ ] `trunc` length tested with max-length release names
- [ ] Stateful resources (PVCs, Secrets) have `resource-policy: keep`
- [ ] Value constraints documented in `values.yaml` comments
- [ ] Label selectors in application code match labels in templates

### Security

- [ ] Path validation uses `startsWith()` on resolved paths
- [ ] CORS origin validation includes port range check
- [ ] No raw internal error bodies in HTTP responses
- [ ] All non-health routes require authentication (tested)

### Cross-Component

- [ ] Label selectors tested against rendered Helm output
- [ ] API response shapes asserted in both producer and consumer tests
- [ ] Status/phase enum values handled exhaustively in the frontend
