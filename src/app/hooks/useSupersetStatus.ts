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
  const hasDataRef = useRef(false);
  const controllerRef = useRef<AbortController>();
  const stoppedRef = useRef(false);

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

  const startPoll = useCallback(
    (controller: AbortController) => {
      const poll = async () => {
        if (stoppedRef.current) return;
        try {
          if (!hasDataRef.current) setLoading(true);
          const data = await fetchStatus(controller.signal);
          if (stoppedRef.current) return;
          setStatus(data);
          setError(null);
          setLoading(false);
          hasDataRef.current = true;

          const interval =
            data?.phase === 'deploying' ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_STABLE;
          timerRef.current = setTimeout(poll, interval);
        } catch (e) {
          if (stoppedRef.current) return;
          if (e instanceof DOMException && e.name === 'AbortError') return;
          setError(e instanceof Error ? e.message : 'Status check failed');
          setLoading(false);
          timerRef.current = setTimeout(poll, POLL_INTERVAL_STABLE);
        }
      };
      poll();
    },
    [fetchStatus],
  );

  const refresh = useCallback(() => {
    if (!namespace) return;
    clearTimeout(timerRef.current);
    controllerRef.current?.abort();

    const controller = new AbortController();
    controllerRef.current = controller;
    stoppedRef.current = false;

    setLoading(true);
    setError(null);
    startPoll(controller);
  }, [namespace, startPoll]);

  useEffect(() => {
    if (!namespace) {
      setStatus(null);
      setError(null);
      hasDataRef.current = false;
      return;
    }

    stoppedRef.current = false;
    const controller = new AbortController();
    controllerRef.current = controller;

    startPoll(controller);

    return () => {
      stoppedRef.current = true;
      controllerRef.current?.abort();
      clearTimeout(timerRef.current);
    };
  }, [namespace, startPoll]);

  return { status, loading, error, refresh };
}
