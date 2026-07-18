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

jest.mock('../../utils/supersetClient', () => {
  const mockHealthyClient = {
    getSupersetHealth: jest.fn().mockResolvedValue({ healthy: true, version: '4.1.1' }),
  };
  const MockSupersetClient = Object.assign(
    jest.fn().mockImplementation(() => mockHealthyClient),
    {
      forHealthCheck: jest.fn().mockReturnValue(mockHealthyClient),
    },
  );
  return { SupersetClient: MockSupersetClient };
});

import supersetStatusRouter from '../../routes/supersetStatus';
import { getResource } from '../../utils/k8sApply';
import { K8sApiError } from '../../utils/k8sClient';
import { getRouteUrl } from '../../utils/routeUrl';
import { SupersetClient } from '../../utils/supersetClient';
import { createTestApp, createTestAppNoToken, testRequest } from '../helpers/testServer';

const mockGetResource = getResource as jest.MockedFunction<typeof getResource>;
const mockGetRouteUrl = getRouteUrl as jest.MockedFunction<typeof getRouteUrl>;

const MOUNT_PATH = '/api/superset/status';

describe('GET /api/superset/status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRouteUrl.mockResolvedValue(undefined);
  });

  it('returns 401 when token is missing', async () => {
    const app = createTestAppNoToken(supersetStatusRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/status?namespace=test-ns');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns 400 when namespace is missing', async () => {
    const app = createTestApp(supersetStatusRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/status');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(body.error).toContain('namespace');
  });

  it('returns not-deployed when deployments are not found', async () => {
    mockGetResource.mockRejectedValue(
      new K8sApiError('Not found', 404, ''),
    );

    const app = createTestApp(supersetStatusRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/status?namespace=test-ns');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.phase).toBe('not-deployed');
    expect(body.healthy).toBe(false);
  });

  it('returns deploying (not not-deployed) when only one deployment is missing', async () => {
    // Superset deployment found but postgres returns 404 — only one is missing,
    // so this should NOT be treated as not-deployed (requires both found=false).
    mockGetResource.mockImplementation(async (_token, _av, _kind, _namespace, name) => {
      const deploymentName = name as string;
      if (deploymentName.includes('postgres')) {
        throw new K8sApiError('Not found', 404, '');
      }
      return {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: deploymentName },
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

    const app = createTestApp(supersetStatusRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/status?namespace=test-ns');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.phase).toBe('deploying');
    expect(body.phase).not.toBe('not-deployed');
  });

  it('returns deploying when pods are not yet ready', async () => {
    mockGetResource.mockImplementation(async (_token, _av, _kind, _namespace, name) => {
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

    const app = createTestApp(supersetStatusRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/status?namespace=test-ns');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.phase).toBe('deploying');
    expect(body.healthy).toBe(false);
  });

  it('returns running when all pods are ready and health check passes', async () => {
    mockGetResource.mockImplementation(async (_token, _av, _kind, _namespace, name) => {
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

    mockGetRouteUrl.mockResolvedValue('https://superset.apps.test.com');

    const app = createTestApp(supersetStatusRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/status?namespace=test-ns');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.phase).toBe('running');
    expect(body.healthy).toBe(true);
    expect(body.url).toBe('https://superset.apps.test.com');
  });

  it('returns error when pods are ready but health check fails', async () => {
    mockGetResource.mockImplementation(async (_token, _av, _kind, _namespace, name) => {
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

    (SupersetClient.forHealthCheck as jest.Mock).mockReturnValue({
      getSupersetHealth: jest.fn().mockResolvedValue({ healthy: false }),
    });

    const app = createTestApp(supersetStatusRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/status?namespace=test-ns');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.phase).toBe('error');
    expect(body.healthy).toBe(false);
  });
});
