import {
  apacheSupersetAreaExtension,
  communityPluginsSectionExtension,
  apacheSupersetSectionExtension,
  instanceNavExtension,
  dashboardsNavExtension,
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
    it('should define Instance nav item under apache-superset section', () => {
      expect(instanceNavExtension.type).toBe('app.navigation/href');
      expect(instanceNavExtension.properties.id).toBe('apache-superset-instance');
      expect(instanceNavExtension.properties.title).toBe('Instance');
      expect(instanceNavExtension.properties.href).toBe('/apache-superset/instance');
      expect(instanceNavExtension.properties.section).toBe('apache-superset');
      expect(instanceNavExtension.properties.path).toBe('/apache-superset/instance/*');
    });

    it('should define Dashboards nav item under apache-superset section', () => {
      expect(dashboardsNavExtension.type).toBe('app.navigation/href');
      expect(dashboardsNavExtension.properties.id).toBe('apache-superset-dashboards');
      expect(dashboardsNavExtension.properties.title).toBe('Dashboards');
      expect(dashboardsNavExtension.properties.href).toBe('/apache-superset/dashboards');
      expect(dashboardsNavExtension.properties.section).toBe('apache-superset');
      expect(dashboardsNavExtension.properties.path).toBe('/apache-superset/dashboards/*');
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
    it('should contain all six extensions', () => {
      expect(extensions).toHaveLength(6);
    });

    it('should include all extensions in the correct order', () => {
      expect(extensions).toEqual([
        communityPluginsSectionExtension,
        apacheSupersetAreaExtension,
        apacheSupersetSectionExtension,
        instanceNavExtension,
        dashboardsNavExtension,
        apacheSupersetRouteExtension,
      ]);
    });
  });
});
