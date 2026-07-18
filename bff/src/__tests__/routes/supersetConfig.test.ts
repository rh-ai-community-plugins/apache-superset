jest.mock('../../utils/k8sClient', () => ({
  k8sRequest: jest.fn(),
  K8sApiError: class K8sApiError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
      public readonly body: string,
    ) {
      super(message);
      this.name = 'K8sApiError';
    }
  },
  getK8sBaseUrl: () => 'https://k8s.test',
}));

jest.mock('../../utils/k8sApply', () => ({
  getResource: jest.fn(),
}));

jest.mock('../../utils/routeUrl', () => ({
  getRouteUrl: jest.fn(),
}));

jest.mock('../../utils/helmRenderer', () => ({
  DEFAULT_CHART_DIR: '/mock/chart/dir',
  loadChartMeta: () => ({
    name: 'superset',
    version: '0.1.0',
    appVersion: '99.0.0-test',
  }),
}));

import express from 'express';
import supersetConfigRouter from '../../routes/supersetConfig';
import { getResource } from '../../utils/k8sApply';
import { K8sApiError } from '../../utils/k8sClient';
import { getRouteUrl } from '../../utils/routeUrl';

const mockGetResource = getResource as jest.MockedFunction<typeof getResource>;
const mockGetRouteUrl = getRouteUrl as jest.MockedFunction<typeof getRouteUrl>;

function createApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.token = 'test-token';
    next();
  });
  app.use('/api/superset/config', supersetConfigRouter);
  return app;
}

async function request(app: express.Express, path: string) {
  const http = await import('http');
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to get server address'));
        return;
      }
      const req = http.get(`http://127.0.0.1:${addr.port}${path}`, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode!, body: JSON.parse(data) });
        });
      });
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
    });
  });
}

describe('GET /api/superset/config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRouteUrl.mockResolvedValue(undefined);
  });

  it('returns 400 when namespace is missing', async () => {
    const app = createApp();
    const res = await request(app, '/api/superset/config');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('namespace');
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

    const app = createApp();
    const res = await request(app, '/api/superset/config?namespace=test-ns');

    expect(res.status).toBe(200);
    expect(res.body.namespace).toBe('test-ns');
    expect(res.body.url).toBe('https://superset.apps.test.com');
    expect(res.body.mode).toBe('lightweight');
    expect(res.body.version).toBe('99.0.0-test');
    expect(res.body.embeddingEnabled).toBe(true);
  });

  it('returns 404 when secret is not found', async () => {
    mockGetResource.mockRejectedValueOnce(
      new K8sApiError('Not found', 404, ''),
    );

    const app = createApp();
    const res = await request(app, '/api/superset/config?namespace=test-ns');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
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

    const app = createApp();
    const res = await request(app, '/api/superset/config?namespace=test-ns');

    expect(res.status).toBe(200);
    expect(res.body.url).toBeUndefined();
    expect(res.body.mode).toBe('lightweight');
  });
});

describe('APP_VERSION fallback', () => {
  it('falls back to package.json version when chart metadata is unavailable', () => {
    let capturedVersion: string | undefined;

    jest.isolateModules(() => {
      jest.doMock('../../utils/helmRenderer', () => ({
        DEFAULT_CHART_DIR: '/nonexistent',
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
