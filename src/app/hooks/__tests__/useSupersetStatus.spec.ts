import { renderHook, waitFor, act } from '@testing-library/react';
import { useSupersetStatus } from '../useSupersetStatus';
import { SupersetStatus } from '~/app/types';

describe('useSupersetStatus', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const runningStatus: SupersetStatus = {
    phase: 'running',
    healthy: true,
    version: '4.1.1',
    url: 'https://superset.example.com',
  };

  const deployingStatus: SupersetStatus = {
    phase: 'deploying',
    healthy: false,
  };

  it('should return null status when namespace is null', () => {
    const { result } = renderHook(() => useSupersetStatus(null));
    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should fetch status for a namespace', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(runningStatus),
    });

    const { result } = renderHook(() => useSupersetStatus('test-ns'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.status).toEqual(runningStatus);
    expect(result.current.error).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      '/apache-superset/api/superset/status?namespace=test-ns',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('should poll with shorter interval while deploying', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(deployingStatus),
    });

    renderHook(() => useSupersetStatus('test-ns'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  it('should poll with longer interval when stable', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(runningStatus),
    });

    renderHook(() => useSupersetStatus('test-ns'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  it('should set error on fetch failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useSupersetStatus('test-ns'));

    await waitFor(() => expect(result.current.error).toBe('Status check failed: 500'));
    expect(result.current.status).toBeNull();
  });

  it('should reset on namespace change to null', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(runningStatus),
    });

    const { result, rerender } = renderHook(
      ({ ns }) => useSupersetStatus(ns),
      { initialProps: { ns: 'test-ns' as string | null } },
    );

    await waitFor(() => expect(result.current.status).toEqual(runningStatus));

    rerender({ ns: null });

    expect(result.current.status).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should support manual refresh', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(runningStatus),
    });

    const { result } = renderHook(() => useSupersetStatus('test-ns'));

    await waitFor(() => expect(result.current.status).toEqual(runningStatus));

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledTimes(2),
    );
  });

  it('should stop polling on unmount', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(runningStatus),
    });

    const { unmount } = renderHook(() => useSupersetStatus('test-ns'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    unmount();

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
