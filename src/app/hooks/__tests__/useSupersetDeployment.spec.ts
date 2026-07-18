import { renderHook, act } from '@testing-library/react';
import { useSupersetDeployment } from '../useSupersetDeployment';

describe('useSupersetDeployment', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should start with idle state', () => {
    const { result } = renderHook(() => useSupersetDeployment());
    expect(result.current.deploying).toBe(false);
    expect(result.current.tearing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  describe('deploy', () => {
    it('should POST to the deploy endpoint', async () => {
      const deployResult = {
        message: 'Deployed',
        namespace: 'test-ns',
        applied: [{ kind: 'Deployment', name: 'superset' }],
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(deployResult),
      });

      const { result } = renderHook(() => useSupersetDeployment());

      let response: unknown;
      await act(async () => {
        response = await result.current.deploy('test-ns', 'https://dashboard.example.com');
      });

      expect(response).toEqual(deployResult);
      expect(global.fetch).toHaveBeenCalledWith(
        '/apache-superset/api/superset/deploy',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            namespace: 'test-ns',
            dashboardOrigin: 'https://dashboard.example.com',
          }),
        }),
      );
      expect(result.current.deploying).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should set deploying during the request', async () => {
      let resolveRequest: (value: unknown) => void;
      const pending = new Promise((resolve) => {
        resolveRequest = resolve;
      });
      global.fetch = jest.fn().mockReturnValue(pending);

      const { result } = renderHook(() => useSupersetDeployment());

      let deployPromise: Promise<unknown>;
      act(() => {
        deployPromise = result.current.deploy('ns', 'https://example.com');
      });

      expect(result.current.deploying).toBe(true);

      await act(async () => {
        resolveRequest!({
          ok: true,
          json: () => Promise.resolve({ message: 'ok', namespace: 'ns', applied: [] }),
        });
        await deployPromise!;
      });

      expect(result.current.deploying).toBe(false);
    });

    it('should set error and return undefined on failure', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal error' }),
      });

      const { result } = renderHook(() => useSupersetDeployment());

      let response: unknown;
      await act(async () => {
        response = await result.current.deploy('ns', 'https://example.com');
      });

      expect(response).toBeUndefined();
      expect(result.current.error).toBe('Internal error');
      expect(result.current.deploying).toBe(false);
    });
  });

  describe('teardown', () => {
    it('should DELETE the deploy endpoint', async () => {
      const teardownResult = {
        message: 'Deleted',
        namespace: 'test-ns',
        deleted: [{ kind: 'Deployment', name: 'superset' }],
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(teardownResult),
      });

      const { result } = renderHook(() => useSupersetDeployment());

      let response: unknown;
      await act(async () => {
        response = await result.current.teardown('test-ns');
      });

      expect(response).toEqual(teardownResult);
      expect(global.fetch).toHaveBeenCalledWith(
        '/apache-superset/api/superset/deploy?namespace=test-ns',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(result.current.tearing).toBe(false);
    });

    it('should include force parameter when specified', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ message: 'ok', namespace: 'ns', deleted: [] }),
      });

      const { result } = renderHook(() => useSupersetDeployment());

      await act(async () => {
        await result.current.teardown('ns', true);
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/apache-superset/api/superset/deploy?namespace=ns&force=true',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('should set error and return undefined on teardown failure', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Teardown failed' }),
      });

      const { result } = renderHook(() => useSupersetDeployment());

      let response: unknown;
      await act(async () => {
        response = await result.current.teardown('ns');
      });

      expect(response).toBeUndefined();
      expect(result.current.error).toBe('Teardown failed');
      expect(result.current.tearing).toBe(false);
    });
  });
});
