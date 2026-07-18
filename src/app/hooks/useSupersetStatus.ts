import { useState, useEffect, useCallback, useRef } from 'react';
import { SupersetStatus } from '~/app/types';

const POLL_INTERVAL_ACTIVE = 10_000;
const POLL_INTERVAL_STABLE = 30_000;

interface UseSupersetStatusReturn {
  status: SupersetStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useSupersetStatus(namespace: string | null): UseSupersetStatusReturn {
  const [status, setStatus] = useState<SupersetStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchStatus = useCallback(
    async (signal?: AbortSignal): Promise<SupersetStatus | null> => {
      if (!namespace) return null;
      const response = await fetch(
        `/apache-superset/api/superset/status?namespace=${encodeURIComponent(namespace)}`,
        { signal },
      );
      if (!response.ok) {
        throw new Error(`Status check failed: ${response.status}`);
      }
      return (await response.json()) as SupersetStatus;
    },
    [namespace],
  );

  const refresh = useCallback(() => {
    if (!namespace) return;
    setLoading(true);
    setError(null);
    fetchStatus()
      .then((data) => {
        setStatus(data);
        setLoading(false);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : 'Status check failed');
        setLoading(false);
      });
  }, [namespace, fetchStatus]);

  useEffect(() => {
    if (!namespace) {
      setStatus(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let stopped = false;

    const poll = async () => {
      if (stopped) return;
      try {
        setLoading((prev) => (status === null ? true : prev));
        const data = await fetchStatus(controller.signal);
        if (stopped) return;
        setStatus(data);
        setError(null);
        setLoading(false);

        const interval =
          data?.phase === 'deploying' ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_STABLE;
        timerRef.current = setTimeout(poll, interval);
      } catch (e) {
        if (stopped) return;
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : 'Status check failed');
        setLoading(false);
        timerRef.current = setTimeout(poll, POLL_INTERVAL_STABLE);
      }
    };

    poll();

    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timerRef.current);
    };
  }, [namespace, fetchStatus]);

  return { status, loading, error, refresh };
}
