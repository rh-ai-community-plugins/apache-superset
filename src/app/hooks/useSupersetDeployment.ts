import { useState, useCallback } from 'react';
import { DeployResult, TeardownResult } from '~/app/types';

interface UseSupersetDeploymentReturn {
  deploy: (namespace: string, dashboardOrigin: string) => Promise<DeployResult | undefined>;
  teardown: (namespace: string, force?: boolean) => Promise<TeardownResult | undefined>;
  deploying: boolean;
  tearing: boolean;
  error: string | null;
}

export function useSupersetDeployment(): UseSupersetDeploymentReturn {
  const [deploying, setDeploying] = useState(false);
  const [tearing, setTearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deploy = useCallback(
    async (namespace: string, dashboardOrigin: string): Promise<DeployResult | undefined> => {
      setDeploying(true);
      setError(null);
      try {
        const response = await fetch('/apache-superset/api/superset/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ namespace, dashboardOrigin }),
        });
        const data = await response.json();
        if (!response.ok) {
          setError(data.error || data.message || `Deploy failed: ${response.status}`);
          return undefined;
        }
        return data as DeployResult;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Deploy failed');
        return undefined;
      } finally {
        setDeploying(false);
      }
    },
    [],
  );

  const teardown = useCallback(
    async (namespace: string, force = false): Promise<TeardownResult | undefined> => {
      setTearing(true);
      setError(null);
      try {
        const params = new URLSearchParams({ namespace });
        if (force) params.set('force', 'true');
        const response = await fetch(
          `/apache-superset/api/superset/deploy?${params}`,
          { method: 'DELETE' },
        );
        const data = await response.json();
        if (!response.ok) {
          setError(data.error || data.message || `Teardown failed: ${response.status}`);
          return undefined;
        }
        return data as TeardownResult;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Teardown failed');
        return undefined;
      } finally {
        setTearing(false);
      }
    },
    [],
  );

  return { deploy, teardown, deploying, tearing, error };
}
