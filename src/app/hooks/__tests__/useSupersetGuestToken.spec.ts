import { renderHook } from '@testing-library/react';
import { useSupersetGuestToken } from '../useSupersetGuestToken';

describe('useSupersetGuestToken', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should return a fetchGuestToken function', () => {
    const { result } = renderHook(() =>
      useSupersetGuestToken('test-ns', 'abc-123'),
    );
    expect(typeof result.current).toBe('function');
  });

  it('should throw when namespace is null', async () => {
    const { result } = renderHook(() =>
      useSupersetGuestToken(null, 'abc-123'),
    );
    await expect(result.current()).rejects.toThrow(
      'Namespace and dashboard ID are required',
    );
  });

  it('should throw when dashboardId is null', async () => {
    const { result } = renderHook(() =>
      useSupersetGuestToken('test-ns', null),
    );
    await expect(result.current()).rejects.toThrow(
      'Namespace and dashboard ID are required',
    );
  });

  it('should fetch and return guest token', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ guestToken: 'token-xyz' }),
    });

    const { result } = renderHook(() =>
      useSupersetGuestToken('test-ns', 'abc-123'),
    );
    const token = await result.current();

    expect(token).toBe('token-xyz');
    expect(global.fetch).toHaveBeenCalledWith(
      '/apache-superset/api/superset/guest-token?namespace=test-ns&dashboard=abc-123',
    );
  });

  it('should throw on non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });

    const { result } = renderHook(() =>
      useSupersetGuestToken('test-ns', 'abc-123'),
    );

    await expect(result.current()).rejects.toThrow(
      'Failed to fetch guest token: 403',
    );
  });

  it('should update callback when namespace changes', () => {
    const { result, rerender } = renderHook(
      ({ ns, id }) => useSupersetGuestToken(ns, id),
      { initialProps: { ns: 'ns-1' as string | null, id: 'abc' as string | null } },
    );

    const fn1 = result.current;

    rerender({ ns: 'ns-2', id: 'abc' });

    expect(result.current).not.toBe(fn1);
  });
});
