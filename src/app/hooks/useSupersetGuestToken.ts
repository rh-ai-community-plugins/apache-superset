import { useCallback } from 'react';

export function useSupersetGuestToken(
  namespace: string | null,
  dashboardId: string | null,
): () => Promise<string> {
  return useCallback(async () => {
    if (!namespace || !dashboardId) {
      throw new Error('Namespace and dashboard ID are required');
    }

    const response = await fetch(
      `/apache-superset/api/superset/guest-token?namespace=${encodeURIComponent(namespace)}&dashboard=${encodeURIComponent(dashboardId)}`,
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch guest token: ${response.status}`);
    }

    const data = await response.json();
    return data.guestToken;
  }, [namespace, dashboardId]);
}
