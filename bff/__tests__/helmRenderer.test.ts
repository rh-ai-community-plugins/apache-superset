import path from 'path';
import fs from 'fs';
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

describe('renderHelmTemplates — chartDir validation', () => {
  it('rejects paths outside the allowed directories', () => {
    expect(() =>
      renderHelmTemplates(
        { releaseName: 'r', namespace: 'ns', values: {} },
        '/tmp/attacker/chart/charts/evil',
      ),
    ).toThrow('chartDir must be within the chart/charts/ directory or match SUPERSET_CHART_DIR');
  });

  it('rejects arbitrary paths even if they exist', () => {
    expect(() =>
      renderHelmTemplates(
        { releaseName: 'r', namespace: 'ns', values: {} },
        '/tmp',
      ),
    ).toThrow('chartDir must be within the chart/charts/ directory or match SUPERSET_CHART_DIR');
  });
});

describe('renderHelmTemplates', () => {
  let resources: K8sResource[];
  let warnings: string[];

  beforeAll(() => {
    ({ resources, warnings } = renderHelmTemplates(
      {
        releaseName: 'my-release',
        namespace: 'test-namespace',
        values: TEST_VALUES,
      },
      CHART_DIR,
    ));
  });

  it('renders multiple K8s resources', () => {
    expect(resources.length).toBeGreaterThan(0);
  });

  it('returns a warnings array', () => {
    expect(Array.isArray(warnings)).toBe(true);
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
    const { resources: routeResources } = renderHelmTemplates(
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
    const { resources: customResources } = renderHelmTemplates(
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
    const { resources: longResources } = renderHelmTemplates(
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

describe('renderHelmTemplates — warnings', () => {
  const chartDir = path.resolve(__dirname, '../../chart/charts/__tmp_warn_test__');

  function writeTemplate(name: string, content: string): void {
    fs.writeFileSync(path.join(chartDir, 'templates', name), content, 'utf8');
  }

  beforeAll(() => {
    // Scaffold a minimal chart directory
    fs.mkdirSync(path.join(chartDir, 'templates'), { recursive: true });
    fs.writeFileSync(
      path.join(chartDir, 'Chart.yaml'),
      'name: superset\nversion: 0.1.0\nappVersion: "4.1.1"\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(chartDir, 'values.yaml'),
      'replicaCount: 1\n',
      'utf8',
    );
  });

  afterAll(() => {
    fs.rmSync(chartDir, { recursive: true, force: true });
  });

  afterEach(() => {
    // Remove any template files between tests
    for (const f of fs.readdirSync(path.join(chartDir, 'templates'))) {
      fs.unlinkSync(path.join(chartDir, 'templates', f));
    }
  });

  it('emits a warning when a YAML document fails to parse', () => {
    writeTemplate('bad.yaml', `
apiVersion: v1
kind: ConfigMap
metadata:
  name: test
data:
  key: : invalid: yaml: [unclosed
`);

    const { resources, warnings } = renderHelmTemplates(
      { releaseName: 'r', namespace: 'ns', values: {} },
      chartDir,
    );

    expect(resources).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.startsWith('Failed to parse YAML document in bad.yaml:'))).toBe(true);
  });

  it('emits a warning when unresolved template directives are stripped', () => {
    writeTemplate('unresolved.yaml', `
apiVersion: v1
kind: ConfigMap
metadata:
  name: test-cm
data:
  value: {{ .Values.nonExistentHelper | someUnknownFilter }}
`);

    const { warnings } = renderHelmTemplates(
      { releaseName: 'r', namespace: 'ns', values: {} },
      chartDir,
    );

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.startsWith('Unresolved template directive stripped:'))).toBe(true);
  });

  it('returns an empty warnings array when all templates render cleanly', () => {
    writeTemplate('clean.yaml', `
apiVersion: v1
kind: ConfigMap
metadata:
  name: clean-cm
  namespace: ns
data:
  key: value
`);

    const { resources, warnings } = renderHelmTemplates(
      { releaseName: 'r', namespace: 'ns', values: {} },
      chartDir,
    );

    expect(resources).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });
});

describe('renderHelmTemplates — with scope rebinding', () => {
  const chartDir = path.resolve(__dirname, '../../chart/charts/__tmp_with_scope_test__');

  function writeTemplate(name: string, content: string): void {
    fs.writeFileSync(path.join(chartDir, 'templates', name), content, 'utf8');
  }

  beforeAll(() => {
    fs.mkdirSync(path.join(chartDir, 'templates'), { recursive: true });
    fs.writeFileSync(
      path.join(chartDir, 'Chart.yaml'),
      'name: superset\nversion: 0.1.0\nappVersion: "4.1.1"\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(chartDir, 'values.yaml'),
      'replicaCount: 1\n',
      'utf8',
    );
  });

  afterAll(() => {
    fs.rmSync(chartDir, { recursive: true, force: true });
  });

  afterEach(() => {
    for (const f of fs.readdirSync(path.join(chartDir, 'templates'))) {
      fs.unlinkSync(path.join(chartDir, 'templates', f));
    }
  });

  it('resolves bare .field references against the with target', () => {
    writeTemplate('with-scope.yaml', `
apiVersion: v1
kind: Secret
metadata:
  name: with-secret
  namespace: ns
stringData:
  {{- with .Values.db }}
  password: {{ .password }}
  host: {{ .host }}
  {{- end }}
`);

    const { resources, warnings } = renderHelmTemplates(
      {
        releaseName: 'r',
        namespace: 'ns',
        values: { db: { password: 'pg-secret', host: 'db.example.com' } },
      },
      chartDir,
    );

    expect(warnings).toHaveLength(0);
    const secret = resources.find((r) => r.kind === 'Secret');
    expect(secret).toBeDefined();
    expect(secret!.stringData!['password']).toBe('pg-secret');
    expect(secret!.stringData!['host']).toBe('db.example.com');
  });

  it('resolves bare .field | quote references against the with target', () => {
    writeTemplate('with-quote.yaml', `
apiVersion: v1
kind: ConfigMap
metadata:
  name: with-cm
  namespace: ns
data:
  {{- with .Values.config }}
  key: {{ .value | quote }}
  {{- end }}
`);

    const { resources } = renderHelmTemplates(
      {
        releaseName: 'r',
        namespace: 'ns',
        values: { config: { value: 'hello-world' } },
      },
      chartDir,
    );

    const cm = resources.find((r) => r.kind === 'ConfigMap');
    expect(cm).toBeDefined();
    expect(cm!.data!['key']).toBe('hello-world');
  });

  it('handles nested with blocks — each block rebinds its own scope', () => {
    // Inner block uses a full .Values path so both scopes can be resolved
    // independently during innermost-first processing.
    writeTemplate('nested-with.yaml', `
apiVersion: v1
kind: ConfigMap
metadata:
  name: nested-cm
  namespace: ns
data:
  {{- with .Values.outer }}
  outerField: {{ .outerValue }}
  {{- with .Values.outer.inner }}
  innerField: {{ .innerValue }}
  {{- end }}
  {{- end }}
`);

    const { resources, warnings } = renderHelmTemplates(
      {
        releaseName: 'r',
        namespace: 'ns',
        values: {
          outer: {
            outerValue: 'from-outer',
            inner: {
              innerValue: 'from-inner',
            },
          },
        },
      },
      chartDir,
    );

    expect(warnings).toHaveLength(0);
    const cm = resources.find((r) => r.kind === 'ConfigMap');
    expect(cm).toBeDefined();
    expect(cm!.data!['outerField']).toBe('from-outer');
    expect(cm!.data!['innerField']).toBe('from-inner');
  });

  it('skips the with body when the target is falsy', () => {
    writeTemplate('with-falsy.yaml', `
apiVersion: v1
kind: ConfigMap
metadata:
  name: falsy-cm
  namespace: ns
data:
  present: "yes"
  {{- with .Values.missing }}
  secret: {{ .password }}
  {{- end }}
`);

    const { resources } = renderHelmTemplates(
      { releaseName: 'r', namespace: 'ns', values: {} },
      chartDir,
    );

    const cm = resources.find((r) => r.kind === 'ConfigMap');
    expect(cm).toBeDefined();
    expect(cm!.data!['present']).toBe('yes');
    expect(cm!.data!['secret']).toBeUndefined();
  });
});
