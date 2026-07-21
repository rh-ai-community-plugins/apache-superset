import { renderHook, act } from '@testing-library/react';
import { useLoadExamples } from '../useLoadExamples';

function encodeSse(data: object): Uint8Array {
  const text = `data: ${JSON.stringify(data)}\n\n`;
  return new TextEncoder().encode(text);
}

function createMockReader(chunks: Uint8Array[]) {
  let index = 0;
  return {
    read: jest.fn(async () => {
      if (index < chunks.length) {
        return { done: false, value: chunks[index++] };
      }
      return { done: true, value: undefined };
    }),
  };
}

const originalFetch = global.fetch;

beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('useLoadExamples', () => {
  it('starts in idle state', () => {
    const { result } = renderHook(() => useLoadExamples());

    expect(result.current.isRunning).toBe(false);
    expect(result.current.isDone).toBe(false);
    expect(result.current.logs).toBe('');
    expect(result.current.error).toBeNull();
    expect(result.current.exitCode).toBeNull();
  });

  it('sets isRunning when startLoadExamples is called', async () => {
    const reader = createMockReader([
      encodeSse({ type: 'done', exitCode: 0 }),
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as unknown as Response);

    const { result } = renderHook(() => useLoadExamples());

    await act(async () => {
      result.current.startLoadExamples('test-ns');
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/apache-superset/api/superset/load-examples',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ namespace: 'test-ns' }),
      }),
    );
  });

  it('accumulates log output from SSE stream', async () => {
    const combined = new Uint8Array([
      ...encodeSse({ stream: 'stdout', text: 'Loading...\n' }),
      ...encodeSse({ stream: 'stderr', text: 'WARNING: test\n' }),
    ]);
    const reader = createMockReader([
      combined,
      encodeSse({ type: 'done', exitCode: 0 }),
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as unknown as Response);

    const { result } = renderHook(() => useLoadExamples());

    await act(async () => {
      result.current.startLoadExamples('test-ns');
    });

    expect(result.current.logs).toContain('Loading...\n');
    expect(result.current.logs).toContain('WARNING: test\n');
    expect(result.current.isDone).toBe(true);
    expect(result.current.exitCode).toBe(0);
    expect(result.current.isRunning).toBe(false);
  });

  it('sets error on command failure', async () => {
    const reader = createMockReader([
      encodeSse({ type: 'error', exitCode: 1, message: 'command failed' }),
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as unknown as Response);

    const { result } = renderHook(() => useLoadExamples());

    await act(async () => {
      result.current.startLoadExamples('test-ns');
    });

    expect(result.current.error).toBe('command failed');
    expect(result.current.exitCode).toBe(1);
    expect(result.current.isRunning).toBe(false);
  });

  it('sets error on non-ok HTTP response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
      json: jest.fn().mockResolvedValue({ error: 'No running Superset pod found' }),
    } as unknown as Response);

    const { result } = renderHook(() => useLoadExamples());

    await act(async () => {
      result.current.startLoadExamples('test-ns');
    });

    expect(result.current.error).toBe('No running Superset pod found');
    expect(result.current.isRunning).toBe(false);
  });

  it('resets all state', async () => {
    const reader = createMockReader([
      encodeSse({ stream: 'stdout', text: 'some output\n' }),
      encodeSse({ type: 'done', exitCode: 0 }),
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as unknown as Response);

    const { result } = renderHook(() => useLoadExamples());

    await act(async () => {
      result.current.startLoadExamples('test-ns');
    });

    expect(result.current.logs).toBeTruthy();

    act(() => {
      result.current.reset();
    });

    expect(result.current.logs).toBe('');
    expect(result.current.isRunning).toBe(false);
    expect(result.current.isDone).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.exitCode).toBeNull();
  });
});
