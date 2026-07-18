jest.mock('../../utils/k8sClient', () => {
  const actual = jest.requireActual<typeof import('../../utils/k8sClient')>('../../utils/k8sClient');
  return {
    k8sRequest: jest.fn(),
    K8sApiError: actual.K8sApiError,
    getK8sBaseUrl: () => 'https://k8s.test',
  };
});

import { getUserInfo } from '../../utils/userIdentity';
import { k8sRequest, K8sApiError } from '../../utils/k8sClient';

const mockK8sRequest = k8sRequest as jest.MockedFunction<typeof k8sRequest>;

describe('getUserInfo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('extracts userName and full name from OpenShift User resource', async () => {
    mockK8sRequest.mockResolvedValue({
      metadata: { name: 'jdoe' },
      fullName: 'Jane Doe',
    });

    const info = await getUserInfo('test-token');

    expect(info.userName).toBe('jdoe');
    expect(info.firstName).toBe('Jane');
    expect(info.lastName).toBe('Doe');
    expect(mockK8sRequest).toHaveBeenCalledWith(
      'test-token',
      '/apis/user.openshift.io/v1/users/~',
    );
  });

  it('handles users with no fullName', async () => {
    mockK8sRequest.mockResolvedValue({
      metadata: { name: 'admin' },
    });

    const info = await getUserInfo('test-token');

    expect(info.userName).toBe('admin');
    expect(info.firstName).toBe('');
    expect(info.lastName).toBe('');
  });

  it('handles multi-part last names', async () => {
    mockK8sRequest.mockResolvedValue({
      metadata: { name: 'mdelacroix' },
      fullName: 'Marie De La Croix',
    });

    const info = await getUserInfo('test-token');

    expect(info.userName).toBe('mdelacroix');
    expect(info.firstName).toBe('Marie');
    expect(info.lastName).toBe('De La Croix');
  });

  it('throws when metadata.name is missing', async () => {
    mockK8sRequest.mockResolvedValue({
      metadata: {},
    });

    await expect(getUserInfo('test-token')).rejects.toThrow(
      'OpenShift User API response missing metadata.name',
    );
  });

  it('throws on empty API response', async () => {
    mockK8sRequest.mockResolvedValue(undefined);

    await expect(getUserInfo('test-token')).rejects.toThrow(
      'Empty response from OpenShift User API',
    );
  });

  it('propagates K8s API errors', async () => {
    mockK8sRequest.mockRejectedValue(
      new K8sApiError('Forbidden', 403, ''),
    );

    await expect(getUserInfo('test-token')).rejects.toThrow(K8sApiError);
  });
});
