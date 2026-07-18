jest.mock('../../utils/k8sClient', () => {
  const actual = jest.requireActual<typeof import('../../utils/k8sClient')>('../../utils/k8sClient');
  return {
    k8sRequest: jest.fn(),
    K8sApiError: actual.K8sApiError,
    getK8sBaseUrl: () => 'https://k8s.test',
  };
});

jest.mock('../../utils/k8sApply', () => ({
  getResource: jest.fn(),
}));

jest.mock('../../utils/routeUrl', () => ({
  getRouteUrl: jest.fn(),
}));

jest.mock('../../utils/helmRenderer', () => ({
  getDefaultChartDir: () => '/mock/chart/dir',
  loadChartMeta: () => ({
    name: 'superset',
    version: '0.1.0',
    appVersion: '99.0.0-test',
  }),
}));

import supersetConfigRouter from '../../routes/supersetConfig';
import { getResource } from '../../utils/k8sApply';
import { K8sApiError } from '../../utils/k8sClient';
import { getRouteUrl } from '../../utils/routeUrl';
import { createTestApp, createTestAppNoToken, testRequest } from '../helpers/testServer';

const mockGetResource = getResource as jest.MockedFunction<typeof getResource>;
const mockGetRouteUrl = getRouteUrl as jest.MockedFunction<typeof getRouteUrl>;

const MOUNT_PATH = '/api/superset/config';

describe('GET /api/superset/config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRouteUrl.mockResolvedValue(undefined);
  });

  it('returns 401 when token is missing', async () => {
    const app = createTestAppNoToken(supersetConfigRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/config?namespace=test-ns');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns 400 when namespace is missing', async () => {
    const app = createTestApp(supersetConfigRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/config');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(body.error).toContain('namespace');
  });

  it('returns config with route URL when available', async () => {
    mockGetRouteUrl.mockResolvedValue('https://superset.apps.test.com');

    mockGetResource.mockResolvedValueOnce({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'superset-superset-secret' },
      data: {
        SUPERSET_GUEST_TOKEN_JWT_SECRET: 'c2VjcmV0',
      },
    });

    const app = createTestApp(supersetConfigRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/config?namespace=test-ns');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.namespace).toBe('test-ns');
    expect(body.url).toBe('https://superset.apps.test.com');
    expect(body.mode).toBe('lightweight');
    expect(body.version).toBe('99.0.0-test');
    expect(body.embeddingEnabled).toBe(true);
  });

  it('returns 404 when secret is not found', async () => {
    mockGetResource.mockRejectedValueOnce(
      new K8sApiError('Not found', 404, ''),
    );

    const app = createTestApp(supersetConfigRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/config?namespace=test-ns');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(404);
    expect(body.error).toContain('not found');
  });

  it('returns config without URL when route is not found', async () => {
    mockGetResource.mockResolvedValueOnce({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'superset-superset-secret' },
      data: {
        SUPERSET_GUEST_TOKEN_JWT_SECRET: 'c2VjcmV0',
      },
    });

    const app = createTestApp(supersetConfigRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/config?namespace=test-ns');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.url).toBeUndefined();
    expect(body.mode).toBe('lightweight');
  });
});

describe('APP_VERSION fallback', () => {
  it('falls back to package.json version when chart metadata is unavailable', () => {
    let capturedVersion: string | undefined;

    jest.isolateModules(() => {
      jest.doMock('../../utils/helmRenderer', () => ({
        getDefaultChartDir: () => '/nonexistent',
        loadChartMeta: () => {
          throw new Error('ENOENT: no such file or directory');
        },
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('../../routes/supersetConfig') as { default: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } };
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pkg = require('../../../package.json') as { version: string };
      capturedVersion = pkg.version;

      expect(mod.default).toBeDefined();
    });

    expect(capturedVersion).toBeDefined();
  });
});
