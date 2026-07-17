// [SHARED] Common section for all community plugins — never changes across plugins.
// Do not change the id or name: all community plugins share this section
// so they appear grouped together in the dashboard sidebar.
export const communityPluginsSectionExtension = {
  type: 'app.navigation/section' as const,
  properties: {
    id: 'community-plugins', // [SHARED] common section for all community plugins
    title: 'Community plugins', // [SHARED]
    group: '9_plugins', // [SHARED]
    iconRef: () => import(/* webpackMode: "eager" */ './CommunityNavIcon'),
  },
};

// [PLUGIN-SPECIFIC] Everything below is specific to this plugin

export const apacheSupersetAreaExtension = {
  type: 'app.area' as const,
  properties: {
    id: 'apache-superset', // [PLUGIN-SPECIFIC] unique area ID
    featureFlags: [] as string[],
  },
};

export const apacheSupersetSectionExtension = {
  type: 'app.navigation/section' as const,
  properties: {
    id: 'apache-superset', // [PLUGIN-SPECIFIC] unique nav section ID
    title: 'Apache Superset', // [PLUGIN-SPECIFIC] display name in sidebar
    group: '1_apache_superset', // [PLUGIN-SPECIFIC] sort key within community-plugins
    section: 'community-plugins', // [SHARED] must match communityPluginsSectionExtension.id — do not change
    iconRef: () => import(/* webpackMode: "eager" */ '~/app/components/ApacheSupersetNavIcon'),
  },
};

export const userInfoNavExtension = {
  type: 'app.navigation/href' as const,
  properties: {
    id: 'apache-superset-user-info', // [PLUGIN-SPECIFIC] unique nav item ID
    title: 'User Info',
    href: '/apache-superset/user-info', // [PLUGIN-SPECIFIC] must match route prefix
    section: 'apache-superset', // [PLUGIN-SPECIFIC] references this plugin's section ID
    path: '/apache-superset/user-info/*', // [PLUGIN-SPECIFIC] route-matching pattern
  },
};

export const clusterResourcesNavExtension = {
  type: 'app.navigation/href' as const,
  properties: {
    id: 'apache-superset-cluster-resources', // [PLUGIN-SPECIFIC] unique nav item ID
    title: 'Cluster Resources',
    href: '/apache-superset/cluster-resources', // [PLUGIN-SPECIFIC] must match route prefix
    section: 'apache-superset', // [PLUGIN-SPECIFIC] references this plugin's section ID
    path: '/apache-superset/cluster-resources/*', // [PLUGIN-SPECIFIC] route-matching pattern
  },
};

export const namespaceSummaryNavExtension = {
  type: 'app.navigation/href' as const,
  properties: {
    id: 'apache-superset-namespace-summary', // [PLUGIN-SPECIFIC] unique nav item ID
    title: 'Namespace Summary',
    href: '/apache-superset/namespace-summary', // [PLUGIN-SPECIFIC] must match route prefix
    section: 'apache-superset', // [PLUGIN-SPECIFIC] references this plugin's section ID
    path: '/apache-superset/namespace-summary/*', // [PLUGIN-SPECIFIC] route-matching pattern
  },
};

export const apacheSupersetRouteExtension = {
  type: 'app.route' as const,
  properties: {
    path: '/apache-superset/*', // [PLUGIN-SPECIFIC] top-level route prefix
    component: () => import(/* webpackMode: "eager" */ '~/app/App'),
  },
};

export const extensions = [
  communityPluginsSectionExtension,
  apacheSupersetAreaExtension,
  apacheSupersetSectionExtension,
  userInfoNavExtension,
  clusterResourcesNavExtension,
  namespaceSummaryNavExtension,
  apacheSupersetRouteExtension,
];

export default extensions;
