# Documentation

This directory contains all project documentation, organized by topic.

## [User Guide](USER_GUIDE.md)

End-user walkthrough: deploying Superset, loading example data, configuring dashboards for embedding, and viewing embedded dashboards in the RHOAI Dashboard.

## Sections

### [Architecture](architecture/)

How the RHOAI Dashboard plugin system works, including the extension contract, Module Federation config, and deployment models. Also includes the [Superset Plugin Architecture](architecture/SUPERSET_PLUGIN_ARCHITECTURE.md) design document covering deployment, embedding, authentication bridging, and Helm chart design.

### [Development](development/)

Local development environment setup, dashboard integration workflow, and reference for the dashboard backend APIs available to plugins.

### [Deployment](deployment/)

Deploying the plugin on OpenShift with Helm, registering it with the RHOAI Dashboard, and configuring the BFF proxy.
