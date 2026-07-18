import React, { useEffect, useRef } from 'react';
import { embedDashboard } from '@superset-ui/embedded-sdk';

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
      unmountFn = dashboard.unmount;
    });

    return () => {
      unmountFn?.();
      if (mount) mount.innerHTML = '';
    };
  }, [dashboardId, supersetDomain, fetchGuestToken]);

  return (
    <div
      ref={mountRef}
      data-testid="superset-embed-container"
      style={{ width: '100%', height: '80vh' }}
    />
  );
};
