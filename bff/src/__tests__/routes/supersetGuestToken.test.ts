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

jest.mock('../../utils/userIdentity', () => ({
  getUserInfo: jest.fn(),
}));

jest.mock('../../utils/supersetClient', () => {
  const mockClient = {
    generateGuestToken: jest.fn(),
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

import supersetGuestTokenRouter from '../../routes/supersetGuestToken';
import { getAdminCredentials, isSecretNotFound } from '../../utils/secretReader';
import { getUserInfo } from '../../utils/userIdentity';
import { SupersetClient, SupersetApiError } from '../../utils/supersetClient';
import { K8sApiError } from '../../utils/k8sClient';
import { createTestApp, createTestAppNoToken, testRequest } from '../helpers/testServer';

const mockGetAdminCredentials = getAdminCredentials as jest.MockedFunction<typeof getAdminCredentials>;
const mockIsSecretNotFound = isSecretNotFound as jest.MockedFunction<typeof isSecretNotFound>;
const mockGetUserInfo = getUserInfo as jest.MockedFunction<typeof getUserInfo>;

const MOUNT_PATH = '/api/superset/guest-token';

const VALID_DASHBOARD_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('GET /api/superset/guest-token', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSecretNotFound.mockImplementation(
      (err) => err instanceof Error && err.message === 'Not found',
    );
  });

  it('returns 401 when token is missing', async () => {
    const app = createTestAppNoToken(supersetGuestTokenRouter, MOUNT_PATH);
    const res = await testRequest(
      app,
      `/api/superset/guest-token?namespace=test-ns&dashboard=${VALID_DASHBOARD_UUID}`,
    );
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns 400 when namespace is missing', async () => {
    const app = createTestApp(supersetGuestTokenRouter, MOUNT_PATH);
    const res = await testRequest(
      app,
      `/api/superset/guest-token?dashboard=${VALID_DASHBOARD_UUID}`,
    );
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(body.error).toContain('namespace');
  });

  it('returns 400 when dashboard UUID is missing', async () => {
    const app = createTestApp(supersetGuestTokenRouter, MOUNT_PATH);
    const res = await testRequest(
      app,
      '/api/superset/guest-token?namespace=test-ns',
    );
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(body.error).toContain('dashboard');
  });

  it('returns 400 when dashboard is not a valid UUID', async () => {
    const app = createTestApp(supersetGuestTokenRouter, MOUNT_PATH);
    const res = await testRequest(
      app,
      '/api/superset/guest-token?namespace=test-ns&dashboard=not-a-uuid',
    );
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(body.error).toContain('dashboard');
  });

  it('returns guest token on success', async () => {
    mockGetAdminCredentials.mockResolvedValue({
      username: 'admin',
      password: 'secret',
      supersetUrl: 'http://superset-svc.test-ns.svc.cluster.local:8088',
    });
    mockGetUserInfo.mockResolvedValue({
      userName: 'jdoe',
      firstName: 'Jane',
      lastName: 'Doe',
    });

    const mockClient = new SupersetClient('', '', '');
    (mockClient.generateGuestToken as jest.Mock).mockResolvedValue('guest-token-abc');

    const app = createTestApp(supersetGuestTokenRouter, MOUNT_PATH);
    const res = await testRequest(
      app,
      `/api/superset/guest-token?namespace=test-ns&dashboard=${VALID_DASHBOARD_UUID}`,
    );
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.guestToken).toBe('guest-token-abc');
  });

  it('returns 404 when Superset secret is not found', async () => {
    const notFoundError = new Error('Not found');
    mockGetAdminCredentials.mockRejectedValue(notFoundError);
    mockIsSecretNotFound.mockReturnValue(true);
    mockGetUserInfo.mockResolvedValue({
      userName: 'jdoe',
      firstName: 'Jane',
      lastName: 'Doe',
    });

    const app = createTestApp(supersetGuestTokenRouter, MOUNT_PATH);
    const res = await testRequest(
      app,
      `/api/superset/guest-token?namespace=test-ns&dashboard=${VALID_DASHBOARD_UUID}`,
    );
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
    mockGetUserInfo.mockResolvedValue({
      userName: 'jdoe',
      firstName: 'Jane',
      lastName: 'Doe',
    });

    const mockClient = new SupersetClient('', '', '');
    (mockClient.generateGuestToken as jest.Mock).mockRejectedValue(
      new SupersetApiError('Unauthorized', 401),
    );

    const app = createTestApp(supersetGuestTokenRouter, MOUNT_PATH);
    const res = await testRequest(
      app,
      `/api/superset/guest-token?namespace=test-ns&dashboard=${VALID_DASHBOARD_UUID}`,
    );
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(body.error).toBe('Superset API request failed');
  });

  it('returns 500 on unexpected errors', async () => {
    mockGetAdminCredentials.mockRejectedValue(new Error('Network down'));
    mockIsSecretNotFound.mockReturnValue(false);
    mockGetUserInfo.mockResolvedValue({
      userName: 'jdoe',
      firstName: 'Jane',
      lastName: 'Doe',
    });

    const app = createTestApp(supersetGuestTokenRouter, MOUNT_PATH);
    const res = await testRequest(
      app,
      `/api/superset/guest-token?namespace=test-ns&dashboard=${VALID_DASHBOARD_UUID}`,
    );
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(body.error).toContain('Internal server error');
  });

  it('returns 500 when getUserInfo throws a K8sApiError', async () => {
    mockGetAdminCredentials.mockResolvedValue({
      username: 'admin',
      password: 'secret',
      supersetUrl: 'http://superset-svc.test-ns.svc.cluster.local:8088',
    });
    mockGetUserInfo.mockRejectedValue(new K8sApiError('Forbidden', 403, ''));

    const app = createTestApp(supersetGuestTokenRouter, MOUNT_PATH);
    const res = await testRequest(
      app,
      `/api/superset/guest-token?namespace=test-ns&dashboard=${VALID_DASHBOARD_UUID}`,
    );
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal server error generating guest token');
  });
});
