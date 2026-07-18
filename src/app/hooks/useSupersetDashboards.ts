import { useState, useEffect, useCallback, useRef } from 'react';
import { SupersetDashboard } from '~/app/types';

interface UseSupersetDashboardsReturn {
  dashboards: SupersetDashboard[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useSupersetDashboards(
  namespace: string | null,
): UseSupersetDashboardsReturn {
  const [dashboards, setDashboards] = useState<SupersetDashboard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController>();

  const fetchDashboards = useCallback(
    async (signal?: AbortSignal) => {
      if (!namespace) return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/apache-superset/api/superset/dashboards?namespace=${encodeURIComponent(namespace)}`,
          { signal },
        );
        if (!response.ok) {
          throw new Error(`Failed to load dashboards: ${response.status}`);
        }
        const data = await response.json();
        setDashboards(data.dashboards ?? []);
        setLoading(false);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : 'Failed to load dashboards');
        setLoading(false);
      }
    },
    [namespace],
  );

  useEffect(() => {
    if (!namespace) {
      setDashboards([]);
      setError(null);
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    fetchDashboards(controller.signal);

    return () => {
      controller.abort();
    };
  }, [namespace, fetchDashboards]);

  const refresh = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    fetchDashboards(controller.signal);
  }, [fetchDashboards]);

  return { dashboards, loading, error, refresh };
}
