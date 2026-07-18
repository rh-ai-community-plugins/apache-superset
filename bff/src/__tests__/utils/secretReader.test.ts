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

import { getAdminCredentials, getSupersetUrl, isSecretNotFound } from '../../utils/secretReader';
import { getResource } from '../../utils/k8sApply';
import { K8sApiError } from '../../utils/k8sClient';
import { getRouteUrl } from '../../utils/routeUrl';

const mockGetResource = getResource as jest.MockedFunction<typeof getResource>;
const mockGetRouteUrl = getRouteUrl as jest.MockedFunction<typeof getRouteUrl>;

describe('getAdminCredentials', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRouteUrl.mockResolvedValue(undefined);
  });

  it('decodes credentials from K8s Secret and resolves service URL', async () => {
    mockGetResource.mockResolvedValue({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'superset-superset-secret' },
      data: {
        ADMIN_USERNAME: Buffer.from('admin').toString('base64'),
        ADMIN_PASSWORD: Buffer.from('s3cret').toString('base64'),
      },
    });

    const creds = await getAdminCredentials('test-token', 'my-ns');

    expect(creds.username).toBe('admin');
    expect(creds.password).toBe('s3cret');
    expect(creds.supersetUrl).toBe(
      'http://superset-superset-svc.my-ns.svc.cluster.local:8088',
    );
  });

  it('prefers Route URL over service URL', async () => {
    mockGetResource.mockResolvedValue({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'superset-superset-secret' },
      data: {
        ADMIN_PASSWORD: Buffer.from('pass').toString('base64'),
      },
    });
    mockGetRouteUrl.mockResolvedValue('https://superset.apps.example.com');

    const creds = await getAdminCredentials('test-token', 'my-ns');

    expect(creds.supersetUrl).toBe('https://superset.apps.example.com');
  });

  it('defaults username to admin when not in secret', async () => {
    mockGetResource.mockResolvedValue({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'superset-superset-secret' },
      data: {
        ADMIN_PASSWORD: Buffer.from('pass').toString('base64'),
      },
    });

    const creds = await getAdminCredentials('test-token', 'my-ns');

    expect(creds.username).toBe('admin');
  });

  it('throws when admin password is missing from secret', async () => {
    mockGetResource.mockResolvedValue({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'superset-superset-secret' },
      data: {},
    });

    await expect(getAdminCredentials('test-token', 'my-ns')).rejects.toThrow(
      'Superset admin password not found in Secret',
    );
  });

  it('propagates 404 when secret is not found', async () => {
    mockGetResource.mockRejectedValue(
      new K8sApiError('Not found', 404, ''),
    );

    await expect(getAdminCredentials('test-token', 'my-ns')).rejects.toThrow(
      K8sApiError,
    );
  });
});

describe('getSupersetUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRouteUrl.mockResolvedValue(undefined);
  });

  it('returns Route URL when available', async () => {
    mockGetRouteUrl.mockResolvedValue('https://superset.apps.example.com');

    const url = await getSupersetUrl('test-token', 'my-ns');
    expect(url).toBe('https://superset.apps.example.com');
  });

  it('falls back to internal service URL', async () => {
    const url = await getSupersetUrl('test-token', 'my-ns');
    expect(url).toBe(
      'http://superset-superset-svc.my-ns.svc.cluster.local:8088',
    );
  });
});

describe('isSecretNotFound', () => {
  it('returns true for K8sApiError 404', () => {
    expect(isSecretNotFound(new K8sApiError('Not found', 404, ''))).toBe(true);
  });

  it('returns false for other K8sApiErrors', () => {
    expect(isSecretNotFound(new K8sApiError('Forbidden', 403, ''))).toBe(false);
  });

  it('returns false for non-K8s errors', () => {
    expect(isSecretNotFound(new Error('something'))).toBe(false);
  });
});
