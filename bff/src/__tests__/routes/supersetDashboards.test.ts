jest.mock('../../utils/k8sClient', () => {
  const actual = jest.requireActual<typeof import('../../utils/k8sClient')>('../../utils/k8sClient');
  return {
    k8sRequest: jest.fn(),
    K8sApiError: actual.K8sApiError,
    getK8sBaseUrl: () => 'https://k8s.test',
  };
});

jest.mock('../../utils/secretReader', () => ({
  getAdminCredentials: jest.fn(),
  isSecretNotFound: jest.fn(),
}));

jest.mock('../../utils/supersetClient', () => {
  const mockClient = {
    listDashboards: jest.fn(),
  };
  return {
    SupersetClient: jest.fn().mockImplementation(() => mockClient),
    SupersetApiError: class SupersetApiError extends Error {
      constructor(
        message: string,
        public readonly statusCode: number,
      ) {
        super(message);
        this.name = 'SupersetApiError';
      }
    },
  };
});

import supersetDashboardsRouter from '../../routes/supersetDashboards';
import { getAdminCredentials, isSecretNotFound } from '../../utils/secretReader';
import { SupersetClient, SupersetApiError } from '../../utils/supersetClient';
import { createTestApp, createTestAppNoToken, testRequest } from '../helpers/testServer';

const mockGetAdminCredentials = getAdminCredentials as jest.MockedFunction<typeof getAdminCredentials>;
const mockIsSecretNotFound = isSecretNotFound as jest.MockedFunction<typeof isSecretNotFound>;

const MOUNT_PATH = '/api/superset/dashboards';

describe('GET /api/superset/dashboards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSecretNotFound.mockImplementation(
      (err) => err instanceof Error && err.message === 'Not found',
    );
  });

  it('returns 401 when token is missing', async () => {
    const app = createTestAppNoToken(supersetDashboardsRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/dashboards?namespace=test-ns');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns 400 when namespace is missing', async () => {
    const app = createTestApp(supersetDashboardsRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/dashboards');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(body.error).toContain('namespace');
  });

  it('returns dashboard list on success', async () => {
    mockGetAdminCredentials.mockResolvedValue({
      username: 'admin',
      password: 'secret',
      supersetUrl: 'http://superset-svc.test-ns.svc.cluster.local:8088',
    });

    const dashboardData = {
      dashboards: [
        {
          id: 1,
          title: 'Sales Dashboard',
          url: '/superset/dashboard/1/',
          status: 'published',
          embeddedId: 'embed-uuid-1',
          thumbnailUrl: '/thumb/1',
        },
      ],
      totalCount: 1,
      page: 0,
      pageSize: 100,
    };

    const mockClient = new SupersetClient('', '', '');
    (mockClient.listDashboards as jest.Mock).mockResolvedValue(dashboardData);

    const app = createTestApp(supersetDashboardsRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/dashboards?namespace=test-ns');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toEqual(dashboardData);
  });

  it('passes page and pageSize query params', async () => {
    mockGetAdminCredentials.mockResolvedValue({
      username: 'admin',
      password: 'secret',
      supersetUrl: 'http://superset-svc.test-ns.svc.cluster.local:8088',
    });

    const mockClient = new SupersetClient('', '', '');
    (mockClient.listDashboards as jest.Mock).mockResolvedValue({
      dashboards: [],
      totalCount: 0,
      page: 2,
      pageSize: 25,
    });

    const app = createTestApp(supersetDashboardsRouter, MOUNT_PATH);
    await testRequest(app, '/api/superset/dashboards?namespace=test-ns&page=2&pageSize=25');

    expect(mockClient.listDashboards).toHaveBeenCalledWith(2, 25);
  });

  it('caps pageSize at 250', async () => {
    mockGetAdminCredentials.mockResolvedValue({
      username: 'admin',
      password: 'secret',
      supersetUrl: 'http://superset-svc.test-ns.svc.cluster.local:8088',
    });

    const mockClient = new SupersetClient('', '', '');
    (mockClient.listDashboards as jest.Mock).mockResolvedValue({
      dashboards: [],
      totalCount: 0,
      page: 0,
      pageSize: 250,
    });

    const app = createTestApp(supersetDashboardsRouter, MOUNT_PATH);
    await testRequest(app, '/api/superset/dashboards?namespace=test-ns&pageSize=9999');

    expect(mockClient.listDashboards).toHaveBeenCalledWith(0, 250);
  });

  it('returns 404 when Superset secret is not found', async () => {
    const notFoundError = new Error('Not found');
    mockGetAdminCredentials.mockRejectedValue(notFoundError);
    mockIsSecretNotFound.mockReturnValue(true);

    const app = createTestApp(supersetDashboardsRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/dashboards?namespace=test-ns');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(404);
    expect(body.error).toContain('not found');
  });

  it('returns Superset API error status on SupersetApiError', async () => {
    mockGetAdminCredentials.mockResolvedValue({
      username: 'admin',
      password: 'secret',
      supersetUrl: 'http://superset-svc.test-ns.svc.cluster.local:8088',
    });

    const mockClient = new SupersetClient('', '', '');
    (mockClient.listDashboards as jest.Mock).mockRejectedValue(
      new SupersetApiError('Service Unavailable', 503),
    );

    const app = createTestApp(supersetDashboardsRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/dashboards?namespace=test-ns');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(503);
    expect(body.error).toBe('Superset API request failed');
  });

  it('returns 500 on unexpected errors', async () => {
    mockGetAdminCredentials.mockRejectedValue(new Error('Connection refused'));
    mockIsSecretNotFound.mockReturnValue(false);

    const app = createTestApp(supersetDashboardsRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/dashboards?namespace=test-ns');
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(body.error).toContain('Internal server error');
  });
});
