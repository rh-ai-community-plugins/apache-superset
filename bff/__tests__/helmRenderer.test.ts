import path from 'path';
import { renderHelmTemplates } from '../src/utils/helmRenderer';
import { K8sResource } from '../src/types';

const CHART_DIR = path.resolve(__dirname, '../../chart/charts/superset');

const TEST_VALUES = {
  image: {
    repository: 'quay.io/test/superset-server',
    tag: '4.1.1',
    pullPolicy: 'IfNotPresent',
  },
  port: 8088,
  admin: {
    username: 'admin',
    password: 'adminpass',
    firstName: 'Superset',
    lastName: 'Admin',
    email: 'admin@superset.local',
  },
  embedding: {
    enabled: true,
    guestTokenJwtSecret: 'jwt-secret-123',
    guestTokenExpSeconds: 300,
    allowedOrigins: 'https://dashboard.example.com',
  },
  secretKey: 'my-secret-key-12345',
  postgres: {
    password: 'pgpass123',
    database: 'superset',
    user: 'superset',
    image: {
      repository: 'registry.redhat.io/rhel9/postgresql-16',
      tag: 'latest',
      pullPolicy: 'IfNotPresent',
    },
    persistence: {
      size: '5Gi',
      storageClass: '',
      keepOnUninstall: true,
    },
    resources: {
      requests: { cpu: '250m', memory: '256Mi' },
      limits: { cpu: '500m', memory: '512Mi' },
    },
  },
  serviceAccount: {
    create: true,
    annotations: {},
    name: '',
  },
  resources: {
    requests: { cpu: '500m', memory: '512Mi' },
    limits: { cpu: '1', memory: '1Gi' },
  },
  initJob: {
    resources: {
      requests: { cpu: '250m', memory: '512Mi' },
      limits: { cpu: '1', memory: '1Gi' },
    },
  },
  securityContext: {
    runAsNonRoot: true,
  },
  tls: {
    forceHttps: 'false',
  },
  route: {
    enabled: false,
    host: '',
    tls: {
      termination: 'edge',
      insecureEdgeTerminationPolicy: 'Redirect',
    },
  },
};

describe('renderHelmTemplates — path traversal validation', () => {
  it('rejects a path that contains chart/charts/ as a substring but is not under the repo chart dir', () => {
    expect(() =>
      renderHelmTemplates(
        { releaseName: 'r', namespace: 'ns', values: {} },
        '/tmp/attacker/chart/charts/evil',
      ),
    ).toThrow('chartDir must be within the chart/charts/ directory');
  });

  it('rejects paths outside the repo entirely', () => {
    expect(() =>
      renderHelmTemplates(
        { releaseName: 'r', namespace: 'ns', values: {} },
        '/tmp/evil',
      ),
    ).toThrow('chartDir must be within the chart/charts/ directory');
  });
});

describe('renderHelmTemplates', () => {
  let resources: K8sResource[];

  beforeAll(() => {
    resources = renderHelmTemplates(
      {
        releaseName: 'my-release',
        namespace: 'test-namespace',
        values: TEST_VALUES,
      },
      CHART_DIR,
    );
  });

  it('renders multiple K8s resources', () => {
    expect(resources.length).toBeGreaterThan(0);
  });

  it('sets namespace on all resources', () => {
    for (const resource of resources) {
      expect(resource.metadata.namespace).toBe('test-namespace');
    }
  });

  it('renders the postgres deployment', () => {
    const pgDeployment = resources.find(
      (r) => r.kind === 'Deployment' && r.metadata.name?.includes('postgres'),
    );
    expect(pgDeployment).toBeDefined();
    expect(pgDeployment!.apiVersion).toBe('apps/v1');
    expect(pgDeployment!.metadata.name).toBe('my-release-superset-postgres');
  });

  it('renders the postgres PVC', () => {
    const pvc = resources.find((r) => r.kind === 'PersistentVolumeClaim');
    expect(pvc).toBeDefined();
    expect(pvc!.metadata.name).toBe('my-release-superset-postgres-pv');
  });

  it('renders the postgres service', () => {
    const svc = resources.find(
      (r) => r.kind === 'Service' && r.metadata.name?.includes('postgres'),
    );
    expect(svc).toBeDefined();
    expect(svc!.metadata.name).toBe('my-release-superset-postgres-svc');
  });

  it('renders the superset configmap', () => {
    const cm = resources.find((r) => r.kind === 'ConfigMap');
    expect(cm).toBeDefined();
    expect(cm!.metadata.name).toBe('my-release-superset-config');
    expect(cm!.data).toBeDefined();
    expect(cm!.data!['superset_config.py']).toContain('SECRET_KEY');
  });

  it('renders the superset deployment', () => {
    const deployment = resources.find(
      (r) => r.kind === 'Deployment' && !r.metadata.name?.includes('postgres'),
    );
    expect(deployment).toBeDefined();
    expect(deployment!.metadata.name).toBe('my-release-superset');
  });

  it('renders the superset secret', () => {
    const secret = resources.find((r) => r.kind === 'Secret');
    expect(secret).toBeDefined();
    expect(secret!.metadata.name).toBe('my-release-superset-secret');
    expect(secret!.stringData).toBeDefined();
    expect(secret!.stringData!['SUPERSET_SECRET_KEY']).toBe('my-secret-key-12345');
    expect(secret!.stringData!['SUPERSET_ADMIN_PASSWORD']).toBe('adminpass');
    expect(secret!.stringData!['POSTGRES_PASSWORD']).toBe('pgpass123');
  });

  it('renders the superset service', () => {
    const svc = resources.find(
      (r) => r.kind === 'Service' && !r.metadata.name?.includes('postgres'),
    );
    expect(svc).toBeDefined();
    expect(svc!.metadata.name).toBe('my-release-superset-svc');
  });

  it('renders the service account', () => {
    const sa = resources.find((r) => r.kind === 'ServiceAccount');
    expect(sa).toBeDefined();
    expect(sa!.metadata.name).toBe('my-release-superset-sa');
  });

  it('does not render route when route.enabled is false', () => {
    const route = resources.find((r) => r.kind === 'Route');
    expect(route).toBeUndefined();
  });

  it('renders route when route.enabled is true', () => {
    const routeResources = renderHelmTemplates(
      {
        releaseName: 'my-release',
        namespace: 'test-namespace',
        values: {
          ...TEST_VALUES,
          route: {
            ...TEST_VALUES.route,
            enabled: true,
          },
        },
      },
      CHART_DIR,
    );

    const route = routeResources.find((r) => r.kind === 'Route');
    expect(route).toBeDefined();
    expect(route!.metadata.name).toBe('my-release-superset-route');
  });

  it('includes correct labels on resources', () => {
    const deployment = resources.find(
      (r) => r.kind === 'Deployment' && !r.metadata.name?.includes('postgres'),
    );
    expect(deployment!.metadata.labels).toBeDefined();
    const labels = deployment!.metadata.labels!;
    expect(labels['app.kubernetes.io/name']).toBe('superset');
    expect(labels['app.kubernetes.io/instance']).toBe('my-release');
    expect(labels['app.kubernetes.io/part-of']).toBe('superset');
    expect(labels['app.kubernetes.io/managed-by']).toBe('Helm');
  });

  it('respects value overrides', () => {
    const customResources = renderHelmTemplates(
      {
        releaseName: 'custom',
        namespace: 'prod',
        values: {
          ...TEST_VALUES,
          admin: { ...TEST_VALUES.admin, username: 'prodadmin' },
        },
      },
      CHART_DIR,
    );

    const secret = customResources.find((r) => r.kind === 'Secret');
    expect(secret!.stringData!['SUPERSET_ADMIN_USERNAME']).toBe('prodadmin');
  });

  it('handles release name truncation', () => {
    const longResources = renderHelmTemplates(
      {
        releaseName: 'a-very-long-release-name-that-exceeds-limits-in-kubernetes',
        namespace: 'test',
        values: TEST_VALUES,
      },
      CHART_DIR,
    );

    for (const resource of longResources) {
      expect(resource.metadata.name!.length).toBeLessThanOrEqual(63);
    }
  });
});
