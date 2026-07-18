import { K8sResource } from '../../types';

jest.mock('../../utils/k8sClient', () => {
  const actual = jest.requireActual<typeof import('../../utils/k8sClient')>('../../utils/k8sClient');
  return {
    k8sRequest: jest.fn(),
    K8sApiError: actual.K8sApiError,
    getK8sBaseUrl: () => 'https://k8s.test',
  };
});

jest.mock('../../utils/k8sApply', () => ({
  applyResource: jest.fn(),
  listResources: jest.fn(),
  deleteResource: jest.fn(),
}));

jest.mock('../../utils/helmRenderer', () => ({
  renderHelmTemplates: jest.fn(),
}));

import supersetDeployRouter from '../../routes/supersetDeploy';
import { k8sRequest } from '../../utils/k8sClient';
import { applyResource, listResources, deleteResource } from '../../utils/k8sApply';
import { renderHelmTemplates } from '../../utils/helmRenderer';
import { TEARDOWN_LABEL_SELECTOR } from '../../utils/resourceNames';
import { createTestApp, createTestAppNoToken, testRequest } from '../helpers/testServer';

const mockK8sRequest = k8sRequest as jest.MockedFunction<typeof k8sRequest>;
const mockApplyResource = applyResource as jest.MockedFunction<typeof applyResource>;
const mockListResources = listResources as jest.MockedFunction<typeof listResources>;
const mockDeleteResource = deleteResource as jest.MockedFunction<typeof deleteResource>;
const mockRenderHelmTemplates = renderHelmTemplates as jest.MockedFunction<typeof renderHelmTemplates>;

const MOUNT_PATH = '/api/superset/deploy';

describe('POST /api/superset/deploy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when token is missing', async () => {
    const app = createTestAppNoToken(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy', {
      method: 'POST',
      body: { namespace: 'test-ns', dashboardOrigin: 'https://dashboard.test' },
    });

    expect(res.status).toBe(401);
    expect((res.body as Record<string, unknown>).error).toBe('Authentication required');
  });

  it('returns 400 when namespace is missing', async () => {
    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy', {
      method: 'POST',
      body: { dashboardOrigin: 'https://dashboard.test' },
    });

    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('namespace is required');
  });

  it('returns 400 for invalid namespace format', async () => {
    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy', {
      method: 'POST',
      body: { namespace: 'INVALID_NS!', dashboardOrigin: 'https://dashboard.test' },
    });

    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toContain('valid Kubernetes namespace');
  });

  it('returns 400 when dashboardOrigin is missing', async () => {
    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy', {
      method: 'POST',
      body: { namespace: 'test-ns' },
    });

    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('dashboardOrigin is required');
  });

  it('returns 400 for invalid dashboardOrigin format', async () => {
    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy', {
      method: 'POST',
      body: { namespace: 'test-ns', dashboardOrigin: 'not-a-url' },
    });

    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toContain('valid HTTP(S) origin');
  });

  it.each([
    ['port 0', 'https://dashboard.example.com:0'],
    ['port 65536', 'https://dashboard.example.com:65536'],
    ['port 99999', 'https://dashboard.example.com:99999'],
  ])('returns 400 for dashboardOrigin with invalid %s', async (_label, dashboardOrigin) => {
    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy', {
      method: 'POST',
      body: { namespace: 'test-ns', dashboardOrigin },
    });

    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toContain('invalid port number');
  });

  it.each([
    ['port 443', 'https://dashboard.example.com:443'],
    ['port 8080', 'https://dashboard.example.com:8080'],
    ['port 65535', 'https://dashboard.example.com:65535'],
    ['port 1', 'https://dashboard.example.com:1'],
  ])('accepts dashboardOrigin with valid %s', async (_label, dashboardOrigin) => {
    mockK8sRequest.mockResolvedValueOnce({
      status: { allowed: true },
    });
    mockRenderHelmTemplates.mockReturnValueOnce({ resources: [], warnings: [] });

    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy', {
      method: 'POST',
      body: { namespace: 'test-ns', dashboardOrigin },
    });

    // Should not be a 400 validation error — passes origin check
    expect(res.status).not.toBe(400);
  });

  it('returns 403 when RBAC check fails', async () => {
    mockK8sRequest.mockResolvedValueOnce({
      status: { allowed: false },
    });

    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy', {
      method: 'POST',
      body: { namespace: 'test-ns', dashboardOrigin: 'https://dashboard.test' },
    });

    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toContain('Insufficient permissions');
  });

  it('deploys successfully with generated secrets', async () => {
    mockK8sRequest.mockResolvedValueOnce({
      status: { allowed: true },
    });

    const mockResources: K8sResource[] = [
      {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name: 'superset-superset-secret', namespace: 'test-ns' },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'superset-superset', namespace: 'test-ns' },
      },
    ];

    mockRenderHelmTemplates.mockReturnValueOnce({
      resources: mockResources,
      warnings: [],
    });

    mockApplyResource
      .mockResolvedValueOnce(mockResources[0])
      .mockResolvedValueOnce(mockResources[1]);

    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy', {
      method: 'POST',
      body: { namespace: 'test-ns', dashboardOrigin: 'https://dashboard.test' },
    });

    expect(res.status).toBe(201);
    const body = res.body as Record<string, unknown>;
    expect(body.message).toBe('Deployment initiated');
    expect(body.namespace).toBe('test-ns');
    expect((body.applied as Array<unknown>)).toHaveLength(2);

    expect(mockRenderHelmTemplates).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseName: 'superset',
        namespace: 'test-ns',
      }),
    );
  });

  it('returns 207 on partial deployment failure', async () => {
    mockK8sRequest.mockResolvedValueOnce({
      status: { allowed: true },
    });

    const mockResources: K8sResource[] = [
      {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name: 'superset-superset-secret', namespace: 'test-ns' },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'superset-superset', namespace: 'test-ns' },
      },
    ];

    mockRenderHelmTemplates.mockReturnValueOnce({
      resources: mockResources,
      warnings: [],
    });

    mockApplyResource
      .mockResolvedValueOnce(mockResources[0])
      .mockRejectedValueOnce(new Error('Failed to apply'));

    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy', {
      method: 'POST',
      body: { namespace: 'test-ns', dashboardOrigin: 'https://dashboard.test' },
    });

    expect(res.status).toBe(207);
    const body = res.body as Record<string, unknown>;
    expect(body.message).toBe('Partially deployed');
    expect((body.applied as Array<unknown>)).toHaveLength(1);
    expect((body.errors as Array<unknown>)).toHaveLength(1);
  });

  it('uses provided secrets when specified', async () => {
    mockK8sRequest.mockResolvedValueOnce({
      status: { allowed: true },
    });

    mockRenderHelmTemplates.mockReturnValueOnce({
      resources: [],
      warnings: [],
    });

    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    await testRequest(app, '/api/superset/deploy', {
      method: 'POST',
      body: {
        namespace: 'test-ns',
        dashboardOrigin: 'https://dashboard.test',
        adminPassword: 'custom-admin-pw',
        secretKey: 'custom-secret-key',
        postgresPassword: 'customPGpw123',
      },
    });

    expect(mockRenderHelmTemplates).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.objectContaining({
          admin: { password: 'custom-admin-pw' },
          secretKey: 'custom-secret-key',
          postgres: { password: 'customPGpw123' },
        }),
      }),
    );
  });
});

describe('DELETE /api/superset/deploy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when token is missing', async () => {
    const app = createTestAppNoToken(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy?namespace=test-ns', {
      method: 'DELETE',
    });

    expect(res.status).toBe(401);
    expect((res.body as Record<string, unknown>).error).toBe('Authentication required');
  });

  it('returns 400 when namespace is missing', async () => {
    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy', { method: 'DELETE' });

    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toContain('namespace');
  });

  it('returns 400 for invalid namespace format', async () => {
    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy?namespace=INVALID!', {
      method: 'DELETE',
    });

    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toContain('valid Kubernetes namespace');
  });

  it('returns 403 when RBAC check fails', async () => {
    mockK8sRequest.mockResolvedValueOnce({
      status: { allowed: false },
    });

    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy?namespace=test-ns', {
      method: 'DELETE',
    });

    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toContain('Insufficient permissions');
  });

  it('deletes resources by label', async () => {
    mockK8sRequest.mockResolvedValueOnce({
      status: { allowed: true },
    });

    mockListResources
      .mockResolvedValueOnce({
        apiVersion: 'apps/v1',
        kind: 'DeploymentList',
        items: [
          { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'superset-superset', namespace: 'test-ns' } } as K8sResource,
        ],
      })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'ServiceList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'ConfigMapList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'SecretList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'PVCList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'SAList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'route.openshift.io/v1', kind: 'RouteList', items: [] });

    mockDeleteResource.mockResolvedValueOnce(undefined);

    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy?namespace=test-ns', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.message).toBe('Teardown initiated');
    expect((body.deleted as Array<unknown>)).toHaveLength(1);
    expect(mockDeleteResource).toHaveBeenCalledWith(
      'test-token',
      'apps/v1',
      'Deployment',
      'test-ns',
      'superset-superset',
    );
    // Verify the teardown uses the combined label selector that matches Helm-rendered labels:
    //   app.kubernetes.io/part-of=superset,app.kubernetes.io/instance=<releaseName>
    expect(mockListResources).toHaveBeenCalledWith(
      'test-token',
      'apps/v1',
      'Deployment',
      'test-ns',
      TEARDOWN_LABEL_SELECTOR,
    );
  });

  it('returns success with empty deleted when no resources found', async () => {
    mockK8sRequest.mockResolvedValueOnce({
      status: { allowed: true },
    });

    mockListResources.mockResolvedValue({
      apiVersion: 'v1',
      kind: 'List',
      items: [],
    });

    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy?namespace=test-ns', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.message).toBe('No resources found');
    expect((body.deleted as Array<unknown>)).toHaveLength(0);
  });

  it('skips PVC with helm.sh/resource-policy: keep when force is not set', async () => {
    mockK8sRequest.mockResolvedValueOnce({
      status: { allowed: true },
    });

    const keepPvc: K8sResource = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name: 'superset-postgres-pv',
        namespace: 'test-ns',
        annotations: { 'helm.sh/resource-policy': 'keep' },
      },
    };

    mockListResources
      .mockResolvedValueOnce({ apiVersion: 'apps/v1', kind: 'DeploymentList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'ServiceList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'ConfigMapList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'SecretList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'PVCList', items: [keepPvc] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'SAList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'route.openshift.io/v1', kind: 'RouteList', items: [] });

    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy?namespace=test-ns', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.message).toBe('Resources found but preserved by resource-policy');
    expect((body.deleted as Array<unknown>)).toHaveLength(0);
    expect(body.skipped).toEqual([{ kind: 'PersistentVolumeClaim', name: 'superset-postgres-pv' }]);
    expect(mockDeleteResource).not.toHaveBeenCalled();
  });

  it('deletes PVC with helm.sh/resource-policy: keep when force=true', async () => {
    mockK8sRequest.mockResolvedValueOnce({
      status: { allowed: true },
    });

    const keepPvc: K8sResource = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name: 'superset-postgres-pv',
        namespace: 'test-ns',
        annotations: { 'helm.sh/resource-policy': 'keep' },
      },
    };

    mockListResources
      .mockResolvedValueOnce({ apiVersion: 'apps/v1', kind: 'DeploymentList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'ServiceList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'ConfigMapList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'SecretList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'PVCList', items: [keepPvc] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'SAList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'route.openshift.io/v1', kind: 'RouteList', items: [] });

    mockDeleteResource.mockResolvedValueOnce(undefined);

    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy?namespace=test-ns&force=true', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.deleted).toEqual([{ kind: 'PersistentVolumeClaim', name: 'superset-postgres-pv' }]);
    expect(body.skipped).toBeUndefined();
    expect(mockDeleteResource).toHaveBeenCalledWith(
      'test-token',
      'v1',
      'PersistentVolumeClaim',
      'test-ns',
      'superset-postgres-pv',
    );
  });

  it('deletes resources without helm.sh/resource-policy annotation normally', async () => {
    mockK8sRequest.mockResolvedValueOnce({
      status: { allowed: true },
    });

    const normalPvc: K8sResource = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name: 'superset-postgres-pv',
        namespace: 'test-ns',
      },
    };

    mockListResources
      .mockResolvedValueOnce({ apiVersion: 'apps/v1', kind: 'DeploymentList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'ServiceList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'ConfigMapList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'SecretList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'PVCList', items: [normalPvc] })
      .mockResolvedValueOnce({ apiVersion: 'v1', kind: 'SAList', items: [] })
      .mockResolvedValueOnce({ apiVersion: 'route.openshift.io/v1', kind: 'RouteList', items: [] });

    mockDeleteResource.mockResolvedValueOnce(undefined);

    const app = createTestApp(supersetDeployRouter, MOUNT_PATH);
    const res = await testRequest(app, '/api/superset/deploy?namespace=test-ns', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.deleted).toEqual([{ kind: 'PersistentVolumeClaim', name: 'superset-postgres-pv' }]);
    expect(body.skipped).toBeUndefined();
    expect(mockDeleteResource).toHaveBeenCalledWith(
      'test-token',
      'v1',
      'PersistentVolumeClaim',
      'test-ns',
      'superset-postgres-pv',
    );
  });
});
