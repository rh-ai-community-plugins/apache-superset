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

  it('throws when POST returns an empty body', async () => {
    mockedK8sRequest.mockResolvedValue(undefined);

    await expect(applyResource('token', configMap)).rejects.toThrow(
      'Unexpected empty response from K8s API: POST /api/v1/namespaces/my-ns/configmaps',
    );
  });

  it('throws when GET returns empty body during 409 conflict resolution', async () => {
    const conflictError = new K8sApiError('conflict', 409, '{}');
    mockedK8sRequest.mockRejectedValueOnce(conflictError);
    mockedK8sRequest.mockResolvedValueOnce(undefined); // GET returns empty

    await expect(applyResource('token', configMap)).rejects.toThrow(
      'Unexpected empty response from K8s API: GET /api/v1/namespaces/my-ns/configmaps/test-config',
    );
  });

  it('throws when PUT returns empty body during 409 conflict resolution', async () => {
    const conflictError = new K8sApiError('conflict', 409, '{}');
    const existingResource = {
      ...configMap,
      metadata: { ...configMap.metadata, resourceVersion: '99' },
    };
    mockedK8sRequest.mockRejectedValueOnce(conflictError);
    mockedK8sRequest.mockResolvedValueOnce(existingResource); // GET succeeds
    mockedK8sRequest.mockResolvedValueOnce(undefined); // PUT returns empty

    await expect(applyResource('token', configMap)).rejects.toThrow(
      'Unexpected empty response from K8s API: PUT /api/v1/namespaces/my-ns/configmaps/test-config',
    );
  });

  it('waits for a terminating resource to be deleted, then re-creates it', async () => {
    const conflictError = new K8sApiError('conflict', 409, '{}');
    const terminatingResource = {
      ...configMap,
      metadata: {
        ...configMap.metadata,
        resourceVersion: '55',
        deletionTimestamp: '2026-07-21T10:00:00Z',
      },
    };
    const notFoundError = new K8sApiError('not found', 404, '{}');

    // 1: POST → 409
    mockedK8sRequest.mockRejectedValueOnce(conflictError);
    // 2: GET → terminating resource
    mockedK8sRequest.mockResolvedValueOnce(terminatingResource);
    // 3: poll GET → 404 (deleted)
    mockedK8sRequest.mockRejectedValueOnce(notFoundError);
    // 4: POST → created
    mockedK8sRequest.mockResolvedValueOnce(configMap);

    const result = await applyResource('token', configMap);

    expect(mockedK8sRequest).toHaveBeenCalledTimes(4);
    // Final call is a POST (re-create), not a PUT
    expect(mockedK8sRequest).toHaveBeenNthCalledWith(
      4,
      'token',
      '/api/v1/namespaces/my-ns/configmaps',
      { method: 'POST', body: configMap },
    );
    expect(result).toEqual(configMap);
  });

  it('polls multiple times while resource is terminating', async () => {
    const conflictError = new K8sApiError('conflict', 409, '{}');
    const terminatingResource = {
      ...configMap,
      metadata: {
        ...configMap.metadata,
        resourceVersion: '55',
        deletionTimestamp: '2026-07-21T10:00:00Z',
      },
    };
    const notFoundError = new K8sApiError('not found', 404, '{}');

    mockedK8sRequest.mockRejectedValueOnce(conflictError);    // POST → 409
    mockedK8sRequest.mockResolvedValueOnce(terminatingResource); // GET → still there
    mockedK8sRequest.mockResolvedValueOnce(terminatingResource); // poll → still there
    mockedK8sRequest.mockRejectedValueOnce(notFoundError);       // poll → gone
    mockedK8sRequest.mockResolvedValueOnce(configMap);           // POST → created

    const result = await applyResource('token', configMap);

    expect(mockedK8sRequest).toHaveBeenCalledTimes(5);
    expect(result).toEqual(configMap);
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

describe('kindToResource (via applyResource)', () => {
  it('throws for an unmapped K8s kind', async () => {
    const ingress: K8sResource = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: { name: 'my-ingress', namespace: 'test-ns' },
    };

    await expect(applyResource('token', ingress)).rejects.toThrow(
      'Unknown K8s kind "Ingress" — add it to KIND_RESOURCE_MAP in k8sApply.ts',
    );
    expect(mockedK8sRequest).not.toHaveBeenCalled();
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

  it('throws when the response body is empty', async () => {
    mockedK8sRequest.mockResolvedValue(undefined);

    await expect(
      getResource('token', 'v1', 'Secret', 'test-ns', 'my-secret'),
    ).rejects.toThrow(
      'Unexpected empty response from K8s API: GET /api/v1/namespaces/test-ns/secrets/my-secret',
    );
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

  it('throws when the response body is empty', async () => {
    mockedK8sRequest.mockResolvedValue(undefined);

    await expect(
      listResources('token', 'v1', 'Secret', 'test-ns'),
    ).rejects.toThrow(
      'Unexpected empty response from K8s API: GET /api/v1/namespaces/test-ns/secrets',
    );
  });
});
