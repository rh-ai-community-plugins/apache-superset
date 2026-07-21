# Project Layout

Directory structure of the plugin.

```text
.
├── src/
│   ├── index.ts                     # Webpack entry — dynamic import to bootstrap.tsx
│   ├── bootstrap.tsx                # React 18 root render (async bootstrap required by Module Federation)
│   ├── rhoai/                       # [DASHBOARD INTEGRATION] — what the host loads
│   │   ├── extensions.ts            #   Extension declarations (area, nav sections, nav items, route)
│   │   └── CommunityNavIcon.tsx     #   [SHARED] Sidebar icon for the community-plugins section — do not modify
│   └── app/                         # [PLUGIN CODE] — your actual plugin
│       ├── App.tsx                  #   Router + CommunityBanner layout
│       ├── components/             #   Shared UI components
│       │   ├── CommunityBanner.tsx  #     [SHARED] "Community Plugin" banner — do not modify
│       │   ├── CommunityBanner.css  #     [SHARED] Banner styles — do not modify
│       │   ├── ApacheSupersetNavIcon.tsx #    [PLUGIN-SPECIFIC] Your plugin's sidebar icon
│       │   ├── ProjectSelector.tsx  #    Project selector with fuzzy search and favorites
│       │   ├── DeployForm.tsx       #    Superset deploy form with namespace + RBAC check
│       │   ├── DeploymentStatusCard.tsx # Running instance status card
│       │   ├── DashboardList.tsx     #    Paginated dashboard list with embed buttons
│       │   ├── SupersetDashboardEmbed.tsx # Embedded dashboard iframe wrapper
│       │   ├── LoadExamplesModal.tsx #    Modal with streaming log output for load-examples
│       │   └── EmbedErrorBoundary.tsx #  Error boundary for embedded dashboard iframes
│       ├── pages/                  #   One file per page/route
│       │   ├── InstanceManagementPage.tsx  # Deploy, monitor, and manage the Superset instance
│       │   └── EmbeddedDashboardsPage.tsx  # Browse and embed Superset dashboards inline
│       └── hooks/                  #   Data-fetching hooks
│           ├── useCurrentUser.ts   #     Dashboard API
│           ├── useProjects.ts      #     K8s API
│           ├── useFavoriteProjects.ts  # localStorage-backed project favorites
│           ├── useLastSelectedProject.ts # localStorage-backed last selected project
│           ├── useAccessReview.ts  #     RBAC check via SelfSubjectAccessReview
│           ├── useSupersetDeployment.ts # Deploy and teardown via BFF
│           ├── useSupersetStatus.ts #    Adaptive-interval status polling
│           ├── useSupersetDashboards.ts # Dashboard list fetching
│           ├── useSupersetGuestToken.ts # Guest token callback for embedding
│           └── useLoadExamples.ts  #     Trigger load-examples with streaming logs
├── config/                          # Webpack configs
│   ├── webpack.common.js            #   Module Federation setup, loaders, path alias (~ → src)
│   ├── webpack.dev.js               #   Dev server (port 9500), proxy rules
│   └── webpack.prod.js              #   Production build to dist/
├── bff/                             # Backend-For-Frontend service (optional — only if using BFF pattern)
│   └── src/
│       ├── server.ts                #   Express server entry
│       ├── types.ts                 #   Shared types (K8sResource, K8sList)
│       ├── routes/                  #   API route handlers
│       └── utils/                   #   K8s client helpers
├── chart/                           # Helm chart for OpenShift deployment
├── Makefile                         # Build, test, image, and chart targets (run `make help`)
├── plugin.yaml                      # Plugin metadata for the RHOAI registry
├── Containerfile                    # Frontend container (Nginx)
└── bff/Containerfile                # BFF container (Node.js)
```

## Codebase orientation

1. **Read** `src/rhoai/extensions.ts` — this is what the dashboard loads. It defines your nav items and routes.
2. **Add pages** under `src/app/pages/` and corresponding nav entries in `extensions.ts`.
3. **Add hooks** under `src/app/hooks/` for data fetching.

## Shared vs plugin-specific

Files marked `[SHARED]` are common to all community plugins. Do not rename, remove, or modify them — they ensure a consistent experience across the community plugin ecosystem:

| File | Purpose |
|---|---|
| `src/rhoai/CommunityNavIcon.tsx` | Common sidebar icon for the community-plugins nav section |
| `src/app/components/CommunityBanner.tsx` | "Community Plugin" banner displayed on every page |
| `src/app/components/CommunityBanner.css` | Styles for the banner |
| `communityPluginsSectionExtension` in `extensions.ts` | Shared nav section that groups all community plugins |

Everything else is yours to change. See [CUSTOMIZATION.md](CUSTOMIZATION.md) for the full list of identifiers to update.
