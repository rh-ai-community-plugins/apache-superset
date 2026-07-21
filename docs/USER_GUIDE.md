# User Guide

This guide walks through the end-user workflows available in the Apache Superset plugin for the RHOAI Dashboard.

## Prerequisites

- The plugin must be deployed on your OpenShift cluster by an administrator (see [Deployment](deployment/OPENSHIFT_DEPLOY.md))
- You need access to at least one OpenShift project (namespace) where you can create resources

## Deploying a Superset Instance

1. Navigate to **Apache Superset → Instance Management** in the RHOAI Dashboard sidebar
2. Select your OpenShift project from the **Project** dropdown
3. Click **Deploy** to start the deployment

The page shows a progress bar while the instance is being created (typically 1–2 minutes). Once running, a status card displays the Superset and PostgreSQL replica counts and an **Open Apache Superset** link to access the Superset UI directly.

## Loading Example Data

Superset ships with built-in example datasets and dashboards that are useful for evaluation and learning. The **Load examples** button populates your instance with this sample data.

### How to use it

1. Deploy a Superset instance (see above) and wait until it is **running**
2. On the Instance Management page, click the **Load examples** button (cube icon) in the status card
3. A modal opens showing real-time log output from the `superset load-examples` command running inside the Superset pod
4. Wait for the command to complete — this can take **5–10 minutes** as it downloads datasets and creates sample dashboards
5. When finished, a success banner appears in the modal. Close it.

### What gets loaded

The command populates Superset with several example datasets (e.g. flights, birth names, world health) and pre-built dashboards that visualize them. After loading, you can browse these dashboards in the Superset UI or — once embedding is configured — view them inline in the RHOAI Dashboard.

### Notes

- While examples are loading, the button changes to **Show logs** so you can reopen the log modal if you closed it
- If the command fails, an error banner shows in the modal with the log output for troubleshooting
- You can navigate away during loading — the process continues in the background on the Superset pod
- The load-examples command is idempotent — running it again will not create duplicate data

## Configuring a Dashboard for Embedding

To display a Superset dashboard inline within the RHOAI Dashboard, you must enable embedding on each dashboard individually in the Superset UI.

### Step 1 — Open the Superset UI

From the Instance Management page, click the **Open Apache Superset** link to open the Superset web interface in a new tab. Log in with the admin credentials (default: `admin` / `admin`).

### Step 2 — Navigate to the dashboard

Click **Dashboards** in the Superset top navigation bar. Click on the dashboard you want to embed (e.g. one of the example dashboards loaded earlier).

### Step 3 — Enable embedding

1. In the dashboard view, click the **three-dot menu** (⋯) in the top-right corner of the dashboard
2. Select **Embed dashboard** from the dropdown menu
3. In the dialog that opens, enter the **allowed domain** — this is the origin URL of your RHOAI Dashboard (e.g. `https://rhods-dashboard-redhat-ods-applications.apps.your-cluster.example.com`)
4. Click **Enable embedding**
5. Superset displays an **Embedded UUID** — you do not need to copy this; the plugin resolves it automatically

Repeat steps 2–5 for each dashboard you want to make available for embedding.

### Step 4 — View embedded dashboards

1. In the RHOAI Dashboard, navigate to **Apache Superset → Dashboards**
2. Select the same project where Superset is deployed
3. Dashboards that have embedding enabled appear with a **View** button
4. Click a dashboard to embed it inline — it renders inside an iframe using the `@superset-ui/embedded-sdk`
5. Use the **fullscreen** button (expand icon) to fill the browser viewport, and the **Open in Superset** link to jump to the full Superset UI

### Troubleshooting embedding

| Symptom | Cause | Fix |
|---------|-------|-----|
| Dashboard appears in the list but has no **View** button | Embedding is not enabled for this dashboard | Open it in Superset UI → three-dot menu → Embed dashboard |
| Embedded dashboard shows a blank iframe or 403 error | The allowed domain does not match the RHOAI Dashboard origin | Edit the embedding settings in Superset and correct the domain |
| No dashboards appear in the list | No dashboards exist in Superset, or Superset is not running | Load example data or create dashboards in the Superset UI |
| "Superset is not running" message on the Dashboards page | The Superset instance is not deployed in the selected project | Switch to the correct project, or deploy an instance from Instance Management |

## Tearing Down the Instance

To remove the Superset instance and free its resources:

1. On the Instance Management page, click **Tear down**
2. Read the data-loss warning — all dashboards, datasets, and configurations will be deleted
3. Check the acknowledgment checkbox
4. Click **Confirm**

The teardown removes the Superset and PostgreSQL deployments, services, routes, and config from the namespace. The Kubernetes Secret with admin credentials is preserved so that a redeployment can reuse the same credentials.
