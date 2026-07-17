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

export const instanceNavExtension = {
  type: 'app.navigation/href' as const,
  properties: {
    id: 'apache-superset-instance',
    title: 'Instance',
    href: '/apache-superset/instance',
    section: 'apache-superset',
    path: '/apache-superset/instance/*',
  },
};

export const dashboardsNavExtension = {
  type: 'app.navigation/href' as const,
  properties: {
    id: 'apache-superset-dashboards',
    title: 'Dashboards',
    href: '/apache-superset/dashboards',
    section: 'apache-superset',
    path: '/apache-superset/dashboards/*',
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
  instanceNavExtension,
  dashboardsNavExtension,
  apacheSupersetRouteExtension,
];

export default extensions;
