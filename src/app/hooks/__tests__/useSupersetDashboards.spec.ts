import { renderHook, waitFor, act } from '@testing-library/react';
import { useSupersetDashboards } from '../useSupersetDashboards';
import { SupersetDashboard } from '~/app/types';

describe('useSupersetDashboards', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  const dashboards: SupersetDashboard[] = [
    {
      id: 1,
      title: 'Sales Dashboard',
      url: '/superset/dashboard/1/',
      status: 'published',
      embeddedId: 'abc-123',
    },
    {
      id: 2,
      title: 'Analytics',
      url: '/superset/dashboard/2/',
      status: 'draft',
    },
  ];

  it('should return empty dashboards when namespace is null', () => {
    const { result } = renderHook(() => useSupersetDashboards(null));
    expect(result.current.dashboards).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should fetch dashboards for a namespace', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ dashboards, totalCount: 2, page: 0, pageSize: 100 }),
    });

    const { result } = renderHook(() => useSupersetDashboards('test-ns'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.dashboards).toEqual(dashboards);
    expect(result.current.error).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      '/apache-superset/api/superset/dashboards?namespace=test-ns',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('should set error on fetch failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useSupersetDashboards('test-ns'));

    await waitFor(() => expect(result.current.error).toBe('Failed to load dashboards: 500'));
    expect(result.current.dashboards).toEqual([]);
  });

  it('should set error on network failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useSupersetDashboards('test-ns'));

    await waitFor(() => expect(result.current.error).toBe('Network error'));
    expect(result.current.dashboards).toEqual([]);
  });

  it('should reset on namespace change to null', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ dashboards, totalCount: 2, page: 0, pageSize: 100 }),
    });

    const { result, rerender } = renderHook(
      ({ ns }) => useSupersetDashboards(ns),
      { initialProps: { ns: 'test-ns' as string | null } },
    );

    await waitFor(() => expect(result.current.dashboards).toEqual(dashboards));

    rerender({ ns: null });

    expect(result.current.dashboards).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('should support manual refresh', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ dashboards, totalCount: 2, page: 0, pageSize: 100 }),
    });

    const { result } = renderHook(() => useSupersetDashboards('test-ns'));

    await waitFor(() => expect(result.current.dashboards).toEqual(dashboards));

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledTimes(2),
    );
  });

  it('should handle missing dashboards field in response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ totalCount: 0, page: 0, pageSize: 100 }),
    });

    const { result } = renderHook(() => useSupersetDashboards('test-ns'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dashboards).toEqual([]);
  });

  it('should abort fetch on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    global.fetch = jest.fn().mockImplementation((_url: string, opts: RequestInit) => {
      capturedSignal = opts.signal as AbortSignal;
      return new Promise(() => undefined);
    });

    const { unmount } = renderHook(() => useSupersetDashboards('test-ns'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });
});
