import {
  apacheSupersetAreaExtension,
  communityPluginsSectionExtension,
  apacheSupersetSectionExtension,
  userInfoNavExtension,
  clusterResourcesNavExtension,
  namespaceSummaryNavExtension,
  apacheSupersetRouteExtension,
  extensions,
} from '../extensions';

describe('RHOAI Plugin Extensions', () => {
  describe('apacheSupersetAreaExtension', () => {
    it('should have the correct type and id', () => {
      expect(apacheSupersetAreaExtension.type).toBe('app.area');
      expect(apacheSupersetAreaExtension.properties.id).toBe('apache-superset');
    });

    it('should have an empty featureFlags array', () => {
      expect(apacheSupersetAreaExtension.properties.featureFlags).toEqual([]);
    });
  });

  describe('communityPluginsSectionExtension', () => {
    it('should define the community-plugins section', () => {
      expect(communityPluginsSectionExtension.type).toBe('app.navigation/section');
      expect(communityPluginsSectionExtension.properties.id).toBe('community-plugins');
      expect(communityPluginsSectionExtension.properties.title).toBe('Community plugins');
      expect(communityPluginsSectionExtension.properties.group).toBe('9_plugins');
    });

    it('should have an iconRef function', () => {
      expect(typeof communityPluginsSectionExtension.properties.iconRef).toBe('function');
    });
  });

  describe('apacheSupersetSectionExtension', () => {
    it('should define a subsection nested under community-plugins', () => {
      expect(apacheSupersetSectionExtension.type).toBe('app.navigation/section');
      expect(apacheSupersetSectionExtension.properties.id).toBe('apache-superset');
      expect(apacheSupersetSectionExtension.properties.title).toBe('Apache Superset');
      expect(apacheSupersetSectionExtension.properties.group).toBe('1_apache_superset');
      expect(apacheSupersetSectionExtension.properties.section).toBe('community-plugins');
      expect(typeof apacheSupersetSectionExtension.properties.iconRef).toBe('function');
    });
  });

  describe('navigation extensions', () => {
    it('should define User Info nav item under apache-superset section', () => {
      expect(userInfoNavExtension.type).toBe('app.navigation/href');
      expect(userInfoNavExtension.properties.id).toBe('apache-superset-user-info');
      expect(userInfoNavExtension.properties.title).toBe('User Info');
      expect(userInfoNavExtension.properties.href).toBe('/apache-superset/user-info');
      expect(userInfoNavExtension.properties.section).toBe('apache-superset');
      expect(userInfoNavExtension.properties.path).toBe('/apache-superset/user-info/*');
    });

    it('should define Cluster Resources nav item under apache-superset section', () => {
      expect(clusterResourcesNavExtension.type).toBe('app.navigation/href');
      expect(clusterResourcesNavExtension.properties.id).toBe('apache-superset-cluster-resources');
      expect(clusterResourcesNavExtension.properties.title).toBe('Cluster Resources');
      expect(clusterResourcesNavExtension.properties.href).toBe('/apache-superset/cluster-resources');
      expect(clusterResourcesNavExtension.properties.section).toBe('apache-superset');
      expect(clusterResourcesNavExtension.properties.path).toBe('/apache-superset/cluster-resources/*');
    });

    it('should define Namespace Summary nav item under apache-superset section', () => {
      expect(namespaceSummaryNavExtension.type).toBe('app.navigation/href');
      expect(namespaceSummaryNavExtension.properties.id).toBe('apache-superset-namespace-summary');
      expect(namespaceSummaryNavExtension.properties.title).toBe('Namespace Summary');
      expect(namespaceSummaryNavExtension.properties.href).toBe('/apache-superset/namespace-summary');
      expect(namespaceSummaryNavExtension.properties.section).toBe('apache-superset');
      expect(namespaceSummaryNavExtension.properties.path).toBe('/apache-superset/namespace-summary/*');
    });
  });

  describe('route extension', () => {
    it('should define a single wildcard route with lazy component', () => {
      expect(apacheSupersetRouteExtension.type).toBe('app.route');
      expect(apacheSupersetRouteExtension.properties.path).toBe('/apache-superset/*');
      expect(typeof apacheSupersetRouteExtension.properties.component).toBe('function');
      expect(apacheSupersetRouteExtension.properties.component()).toBeInstanceOf(Promise);
    });
  });

  describe('extensions array', () => {
    it('should contain all seven extensions', () => {
      expect(extensions).toHaveLength(7);
    });

    it('should include all extensions in the correct order', () => {
      expect(extensions).toEqual([
        communityPluginsSectionExtension,
        apacheSupersetAreaExtension,
        apacheSupersetSectionExtension,
        userInfoNavExtension,
        clusterResourcesNavExtension,
        namespaceSummaryNavExtension,
        apacheSupersetRouteExtension,
      ]);
    });
  });
});
