import React, { useEffect, useRef } from 'react';
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

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let cancelled = false;
    let unmountFn: (() => void) | undefined;

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
    }).then((dashboard) => {
      if (cancelled) {
        dashboard.unmount();
      } else {
        unmountFn = dashboard.unmount;
      }
    });

    return () => {
      cancelled = true;
      unmountFn?.();
      if (mount) mount.replaceChildren();
    };
  }, [dashboardId, supersetDomain, fetchGuestToken]);

  return (
    <div
      ref={mountRef}
      data-testid="superset-embed-container"
      className="pf-v6-u-w-100 superset-embed-container"
    />
  );
};
