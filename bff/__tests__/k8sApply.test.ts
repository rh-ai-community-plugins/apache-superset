import { applyResource, deleteResource, getResource, listResources } from '../src/utils/k8sApply';
import { k8sRequest, K8sApiError } from '../src/utils/k8sClient';
import { K8sResource, K8sList } from '../src/types';

jest.mock('../src/utils/k8sClient', () => {
  const actual = jest.requireActual('../src/utils/k8sClient');
  return {
    ...actual,
    k8sRequest: jest.fn(),
  };
});

const mockedK8sRequest = jest.mocked(k8sRequest);

beforeEach(() => {
  jest.resetAllMocks();
});

describe('applyResource', () => {
  const configMap: K8sResource = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: 'test-config', namespace: 'my-ns' },
    data: { key: 'value' },
  };

  it('creates a resource via POST', async () => {
    mockedK8sRequest.mockResolvedValue(configMap);

    const result = await applyResource('token', configMap);

    expect(mockedK8sRequest).toHaveBeenCalledWith(
      'token',
      '/api/v1/namespaces/my-ns/configmaps',
      { method: 'POST', body: configMap },
    );
    expect(result).toEqual(configMap);
  });

  it('falls back to GET then PUT on 409 conflict', async () => {
    const conflictError = new K8sApiError('conflict', 409, '{}');
    const existingResource = {
      ...configMap,
      metadata: { ...configMap.metadata, resourceVersion: '12345' },
    };
    mockedK8sRequest.mockRejectedValueOnce(conflictError);
    mockedK8sRequest.mockResolvedValueOnce(existingResource);
    mockedK8sRequest.mockResolvedValueOnce(existingResource);

    const result = await applyResource('token', configMap);

    expect(mockedK8sRequest).toHaveBeenCalledTimes(3);
    // 1st: POST (create attempt)
    expect(mockedK8sRequest).toHaveBeenNthCalledWith(
      1,
      'token',
      '/api/v1/namespaces/my-ns/configmaps',
      { method: 'POST', body: configMap },
    );
    // 2nd: GET (fetch existing for resourceVersion)
    expect(mockedK8sRequest).toHaveBeenNthCalledWith(
      2,
      'token',
      '/api/v1/namespaces/my-ns/configmaps/test-config',
    );
    // 3rd: PUT (update with resourceVersion)
    expect(mockedK8sRequest).toHaveBeenNthCalledWith(
      3,
      'token',
      '/api/v1/namespaces/my-ns/configmaps/test-config',
      {
        method: 'PUT',
        body: {
          ...configMap,
          metadata: { ...configMap.metadata, resourceVersion: '12345' },
        },
      },
    );
    expect(result).toEqual(existingResource);
  });

  it('throws non-409 errors', async () => {
    const error = new K8sApiError('forbidden', 403, '{}');
    mockedK8sRequest.mockRejectedValue(error);

    await expect(applyResource('token', configMap)).rejects.toThrow(K8sApiError);
  });

  it('builds correct API path for namespaced core resource', async () => {
    mockedK8sRequest.mockResolvedValue({});

    const secret: K8sResource = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'my-secret', namespace: 'test-ns' },
    };
    await applyResource('token', secret);

    expect(mockedK8sRequest).toHaveBeenCalledWith(
      'token',
      '/api/v1/namespaces/test-ns/secrets',
      expect.any(Object),
    );
  });

  it('builds correct API path for apps/v1 Deployment', async () => {
    mockedK8sRequest.mockResolvedValue({});

    const deployment: K8sResource = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'my-deploy', namespace: 'test-ns' },
    };
    await applyResource('token', deployment);

    expect(mockedK8sRequest).toHaveBeenCalledWith(
      'token',
      '/apis/apps/v1/namespaces/test-ns/deployments',
      expect.any(Object),
    );
  });
});

describe('deleteResource', () => {
  it('sends DELETE to the correct path', async () => {
    mockedK8sRequest.mockResolvedValue({ status: 'Success' });

    await deleteResource('token', 'v1', 'ConfigMap', 'my-ns', 'test-config');

    expect(mockedK8sRequest).toHaveBeenCalledWith(
      'token',
      '/api/v1/namespaces/my-ns/configmaps/test-config',
      { method: 'DELETE' },
    );
  });

  it('handles route.openshift.io apiVersion', async () => {
    mockedK8sRequest.mockResolvedValue({ status: 'Success' });

    await deleteResource('token', 'route.openshift.io/v1', 'Route', 'my-ns', 'my-route');

    expect(mockedK8sRequest).toHaveBeenCalledWith(
      'token',
      '/apis/route.openshift.io/v1/namespaces/my-ns/routes/my-route',
      { method: 'DELETE' },
    );
  });
});

describe('getResource', () => {
  it('fetches a specific resource', async () => {
    const resource: K8sResource = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'my-secret', namespace: 'test-ns' },
    };
    mockedK8sRequest.mockResolvedValue(resource);

    const result = await getResource('token', 'v1', 'Secret', 'test-ns', 'my-secret');

    expect(mockedK8sRequest).toHaveBeenCalledWith(
      'token',
      '/api/v1/namespaces/test-ns/secrets/my-secret',
    );
    expect(result).toEqual(resource);
  });
});

describe('listResources', () => {
  it('lists resources without label selector', async () => {
    const list: K8sList = {
      apiVersion: 'v1',
      kind: 'SecretList',
      items: [],
    };
    mockedK8sRequest.mockResolvedValue(list);

    const result = await listResources('token', 'v1', 'Secret', 'test-ns');

    expect(mockedK8sRequest).toHaveBeenCalledWith(
      'token',
      '/api/v1/namespaces/test-ns/secrets',
    );
    expect(result).toEqual(list);
  });

  it('appends labelSelector as query parameter', async () => {
    mockedK8sRequest.mockResolvedValue({ items: [] });

    await listResources(
      'token',
      'apps/v1',
      'Deployment',
      'test-ns',
      'app.kubernetes.io/part-of=superset',
    );

    expect(mockedK8sRequest).toHaveBeenCalledWith(
      'token',
      '/apis/apps/v1/namespaces/test-ns/deployments?labelSelector=app.kubernetes.io%2Fpart-of%3Dsuperset',
    );
  });
});
