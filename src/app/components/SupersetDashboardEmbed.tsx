import React, { useEffect, useRef, useState } from 'react';
import { Alert } from '@patternfly/react-core';
import { embedDashboard } from '@superset-ui/embedded-sdk';
import './SupersetDashboardEmbed.css';

export interface SupersetDashboardEmbedProps {
  dashboardId: string;
  supersetDomain: string;
  fetchGuestToken: () => Promise<string>;
}

export const SupersetDashboardEmbed: React.FC<SupersetDashboardEmbedProps> = ({
  dashboardId,
  supersetDomain,
  fetchGuestToken,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [embedError, setEmbedError] = useState<string | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let cancelled = false;
    let unmountFn: (() => void) | undefined;

    setEmbedError(null);

    embedDashboard({
      id: dashboardId,
      supersetDomain,
      mountPoint: mount,
      fetchGuestToken,
      dashboardUiConfig: {
        hideTitle: true,
        hideChartControls: false,
        filters: { expanded: false },
      },
    })
      .then((dashboard) => {
        if (cancelled) {
          dashboard.unmount();
        } else {
          unmountFn = dashboard.unmount;
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : 'Failed to load dashboard. Please try again.';
          setEmbedError(message);
        }
      });

    return () => {
      cancelled = true;
      unmountFn?.();
      if (mount) mount.replaceChildren();
    };
  }, [dashboardId, supersetDomain, fetchGuestToken]);

  return (
    <>
      {embedError && (
        <Alert
          variant="danger"
          title="Dashboard failed to load"
          data-testid="superset-embed-error"
        >
          {embedError}
        </Alert>
      )}
      <div
        ref={mountRef}
        data-testid="superset-embed-container"
        className="pf-v6-u-w-100 superset-embed-container"
        role="region"
        aria-label="Embedded Superset dashboard"
      />
    </>
  );
};
