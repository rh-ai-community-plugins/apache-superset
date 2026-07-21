jest.mock('../../utils/k8sApply', () => ({
  listResources: jest.fn(),
}));

import { findSupersetPod } from '../../utils/podFinder';
import { listResources } from '../../utils/k8sApply';

const mockListResources = listResources as jest.MockedFunction<typeof listResources>;

beforeEach(() => {
  jest.resetAllMocks();
});

describe('findSupersetPod', () => {
  it('returns the name of the running Superset pod', async () => {
    mockListResources.mockResolvedValue({
      apiVersion: 'v1',
      kind: 'PodList',
      items: [
        {
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: { name: 'superset-superset-abc123', namespace: 'test-ns' },
          status: { phase: 'Running' },
        },
      ],
    });

    const podName = await findSupersetPod('token', 'test-ns');

    expect(podName).toBe('superset-superset-abc123');
    expect(mockListResources).toHaveBeenCalledWith(
      'token',
      'v1',
      'Pod',
      'test-ns',
      'app.kubernetes.io/name=superset,app.kubernetes.io/instance=superset,app.kubernetes.io/component=server',
    );
  });

  it('throws when no pods are found', async () => {
    mockListResources.mockResolvedValue({
      apiVersion: 'v1',
      kind: 'PodList',
      items: [],
    });

    await expect(findSupersetPod('token', 'test-ns')).rejects.toThrow(
      'No pods matched the label selector',
    );
  });

  it('throws when pods exist but none are Running', async () => {
    mockListResources.mockResolvedValue({
      apiVersion: 'v1',
      kind: 'PodList',
      items: [
        {
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: { name: 'superset-superset-abc123', namespace: 'test-ns' },
          status: { phase: 'Pending' },
        },
      ],
    });

    await expect(findSupersetPod('token', 'test-ns')).rejects.toThrow(
      'Found 1 pod(s) but none Running',
    );
  });

  it('returns the first running pod when multiple exist', async () => {
    mockListResources.mockResolvedValue({
      apiVersion: 'v1',
      kind: 'PodList',
      items: [
        {
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: { name: 'superset-superset-first', namespace: 'test-ns' },
          status: { phase: 'Running' },
        },
        {
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: { name: 'superset-superset-second', namespace: 'test-ns' },
          status: { phase: 'Running' },
        },
      ],
    });

    const podName = await findSupersetPod('token', 'test-ns');

    expect(podName).toBe('superset-superset-first');
  });
});
