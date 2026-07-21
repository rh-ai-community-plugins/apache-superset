# Apache Superset

A community plugin for the **Red Hat OpenShift AI (RHOAI) Dashboard** that deploys [Apache Superset](https://superset.apache.org/) on-demand into a user's OpenShift project and embeds Superset dashboards inline within the RHOAI Dashboard UI.

## What It Does

| Capability | How |
|---|---|
| **Deploy Superset on-demand** | One-click deployment of Superset + PostgreSQL into the user's namespace (lightweight mode: 2 pods, ~750m CPU / 768Mi RAM) |
| **Embed dashboards inline** | Browse and view Superset dashboards directly inside the RHOAI Dashboard using the official [Embedded SDK](https://github.com/apache/superset/tree/master/superset-embedded-sdk) |
| **Bridge authentication** | The user's OpenShift identity is mapped to Superset guest tokens — no separate login required |
| **Manage data connections** | Connect Superset to data warehouses directly from the plugin UI |

### Pages

| Page | Purpose |
|---|---|
| **Instance Management** | Deploy, monitor, and tear down the Superset instance. Shows health status, resource usage, and deployment mode. |
| **Embedded Dashboards** | Browse available dashboards and view them inline via the Superset Embedded SDK. |

### Integration Patterns Used

The plugin uses all three dashboard integration patterns:

- **Dashboard API** (`/api/status`) — user identity and config
- **K8s API pass-through** (`/api/k8s/*`) — RBAC checks via SelfSubjectAccessReview
- **BFF (Backend For Frontend)** — Superset deployment lifecycle, guest token generation, dashboard listing, and data source management

The BFF service (`bff/` directory) is the core integration layer: it deploys Superset resources into K8s, authenticates to the Superset REST API with admin credentials, and generates scoped guest tokens for embedded dashboard access. See [Superset Plugin Architecture](docs/architecture/SUPERSET_PLUGIN_ARCHITECTURE.md) for the full design.

## Quick Start

### Deploy this Plugin on an Existing Dashboard

If you have an OpenShift cluster with RHOAI already running, you can deploy this plugin in three steps using the pre-built container image.

**Prerequisites:** Helm, `oc` CLI access to the cluster, and access to the `redhat-ods-applications` namespace (typically requires cluster-admin).

#### 1. Install the plugin

Install directly from the OCI registry — no need to clone this repo:

```bash
helm install apache-superset oci://quay.io/rh-ai-community-plugins/apache-superset-chart \
  --version 0.1.0 \
  --namespace apache-superset \
  --create-namespace
```

Or, if you have a local checkout of the repository:

```bash
helm install apache-superset chart/ \
  --namespace apache-superset \
  --create-namespace
```

This creates a Deployment and Service for both the frontend (`apache-superset`, serving `remoteEntry.js` via Nginx) and the BFF (`apache-superset-bff`, Node.js backend on port 3000).

#### 2. Register with the RHOAI Dashboard

Retrieve the current Module Federation configuration from the dashboard, append the plugin entry, and apply it:

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

New dashboard pods roll out automatically. After roughly two minutes, reload the RHOAI dashboard to see the plugin's sidebar entries.

#### 3. Verify

Confirm the plugin is registered in the dashboard configuration:

```bash
oc set env deployment/rhods-dashboard -n redhat-ods-applications --list \
  | grep '^MODULE_FEDERATION_CONFIG=' \
  | head -n1 \
  | python3 -c "import json,sys; d=json.loads(sys.stdin.read().split('=',1)[1].strip()); print('\n'.join(e['name'] for e in d))"
```

You should see `apacheSuperset` in the list.

To deploy your own plugin image instead, see [Build & Push](docs/development/BUILD_AND_PUSH.md). For the full deployment guide with Helm chart customization and BFF registration, see [Deploying on OpenShift](docs/deployment/OPENSHIFT_DEPLOY.md).

### Local Development

**Prerequisites:** Node.js 20+, `oc` CLI access to an OpenShift cluster, Docker (for running Superset locally).

```bash
# 1. Start Superset locally (lightweight mode)
docker run -d --name superset-dev -p 8088:8088 \
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
cd bff && npm install
SUPERSET_URL=http://localhost:8088 \
SUPERSET_ADMIN_USERNAME=admin \
SUPERSET_ADMIN_PASSWORD=admin \
K8S_API_BASE=$(oc whoami --show-server) npm run start:dev

# 3. Start the plugin frontend (in another terminal)
cd .. && npm install
npm run start:dev
```

See the full [Local Setup Guide](docs/development/LOCAL_SETUP.md) for step-by-step instructions including dashboard proxy configuration.

#### Build & Test

```bash
npm run build           # Production build to dist/
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # Tests with coverage report
npm run lint            # ESLint on src/ + markdownlint on **/*.md
```

A `Makefile` is also available for unified operations across frontend and BFF — run `make help` for the full list of targets.

## Documentation

See the [docs/](docs/) directory for detailed guides:

- **[User Guide](docs/USER_GUIDE.md)** — End-user walkthrough: deploying Superset, loading example data, configuring dashboards for embedding, and viewing them inline
- **[Architecture](docs/architecture/)** — Plugin system internals, BFF pattern, and the [Superset Plugin Architecture](docs/architecture/SUPERSET_PLUGIN_ARCHITECTURE.md) design document
- **[Development](docs/development/)** — Local environment setup, [customization guide](docs/development/CUSTOMIZATION.md), backend API reference, and [integration test plan](docs/development/TESTING.md)
- **[Deployment](docs/deployment/)** — Deploying the plugin on OpenShift with Helm and dashboard registration

## License

Apache-2.0
