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
  listResources: jest.fn(),
}));

jest.mock('../../utils/supersetClient', () => ({
  SupersetClient: jest.fn().mockImplementation(() => ({
    getSupersetHealth: jest.fn().mockResolvedValue({ healthy: true, version: '4.1.1' }),
  })),
}));

import express from 'express';
import supersetStatusRouter from '../../routes/supersetStatus';
import { getResource } from '../../utils/k8sApply';
import { K8sApiError } from '../../utils/k8sClient';
import { SupersetClient } from '../../utils/supersetClient';

const mockGetResource = getResource as jest.MockedFunction<typeof getResource>;

function createApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.token = 'test-token';
    next();
  });
  app.use('/api/superset/status', supersetStatusRouter);
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

describe('GET /api/superset/status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when namespace is missing', async () => {
    const app = createApp();
    const res = await request(app, '/api/superset/status');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('namespace');
  });

  it('returns not-deployed when deployments are not found', async () => {
    mockGetResource.mockRejectedValue(
      new K8sApiError('Not found', 404, ''),
    );

    const app = createApp();
    const res = await request(app, '/api/superset/status?namespace=test-ns');

    expect(res.status).toBe(200);
    expect(res.body.phase).toBe('not-deployed');
    expect(res.body.healthy).toBe(false);
  });

  it('returns deploying when pods are not yet ready', async () => {
    mockGetResource.mockImplementation(async (_token, _apiVersion, _kind, _namespace, name) => {
      return {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: name as string },
        spec: { replicas: 1 },
        status: {
          readyReplicas: 0,
          replicas: 1,
          conditions: [
            { type: 'Progressing', status: 'True', message: 'Waiting for rollout' },
          ],
        },
      };
    });

    const app = createApp();
    const res = await request(app, '/api/superset/status?namespace=test-ns');

    expect(res.status).toBe(200);
    expect(res.body.phase).toBe('deploying');
    expect(res.body.healthy).toBe(false);
  });

  it('returns running when all pods are ready and health check passes', async () => {
    mockGetResource.mockImplementation(async (_token, _av, kind, _namespace, name) => {
      if (kind === 'Route') {
        return {
          apiVersion: 'route.openshift.io/v1',
          kind: 'Route',
          metadata: { name: name as string },
          spec: {
            host: 'superset.apps.test.com',
            tls: { termination: 'edge' },
          },
        };
      }
      return {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: name as string },
        spec: { replicas: 1 },
        status: {
          readyReplicas: 1,
          replicas: 1,
          conditions: [
            { type: 'Available', status: 'True' },
          ],
        },
      };
    });

    const app = createApp();
    const res = await request(app, '/api/superset/status?namespace=test-ns');

    expect(res.status).toBe(200);
    expect(res.body.phase).toBe('running');
    expect(res.body.healthy).toBe(true);
    expect(res.body.url).toBe('https://superset.apps.test.com');
  });

  it('returns error when pods are ready but health check fails', async () => {
    mockGetResource.mockImplementation(async (_token, _av, kind, _namespace, name) => {
      if (kind === 'Route') {
        throw new K8sApiError('Not found', 404, '');
      }
      return {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: name as string },
        spec: { replicas: 1 },
        status: {
          readyReplicas: 1,
          replicas: 1,
          conditions: [
            { type: 'Available', status: 'True' },
          ],
        },
      };
    });

    (SupersetClient as jest.Mock).mockImplementation(() => ({
      getSupersetHealth: jest.fn().mockResolvedValue({ healthy: false }),
    }));

    const app = createApp();
    const res = await request(app, '/api/superset/status?namespace=test-ns');

    expect(res.status).toBe(200);
    expect(res.body.phase).toBe('error');
    expect(res.body.healthy).toBe(false);
  });
});
