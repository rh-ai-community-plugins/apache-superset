import { render, screen } from '@testing-library/react';
import { SupersetDashboardEmbed } from '../SupersetDashboardEmbed';

jest.mock('@superset-ui/embedded-sdk', () => ({
  embedDashboard: jest.fn().mockResolvedValue({ unmount: jest.fn() }),
}));

import { embedDashboard } from '@superset-ui/embedded-sdk';

describe('SupersetDashboardEmbed', () => {
  const fetchGuestToken = jest.fn().mockResolvedValue('token-xyz');

  beforeEach(() => {
    jest.resetAllMocks();
    (embedDashboard as jest.Mock).mockResolvedValue({ unmount: jest.fn() });
  });

  it('renders mount container', () => {
    render(
      <SupersetDashboardEmbed
        dashboardId="abc-123"
        supersetDomain="https://superset.example.com"
        fetchGuestToken={fetchGuestToken}
      />,
    );
    expect(screen.getByTestId('superset-embed-container')).toBeInTheDocument();
  });

  it('calls embedDashboard with correct params', async () => {
    render(
      <SupersetDashboardEmbed
        dashboardId="abc-123"
        supersetDomain="https://superset.example.com"
        fetchGuestToken={fetchGuestToken}
      />,
    );

    expect(embedDashboard).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'abc-123',
        supersetDomain: 'https://superset.example.com',
        fetchGuestToken,
        mountPoint: expect.any(HTMLElement),
        dashboardUiConfig: {
          hideTitle: true,
          hideChartControls: false,
          filters: { expanded: false },
        },
      }),
    );
  });

  it('calls unmount on cleanup', () => {
    const unmountFn = jest.fn();
    (embedDashboard as jest.Mock).mockResolvedValue({ unmount: unmountFn });

    const { unmount } = render(
      <SupersetDashboardEmbed
        dashboardId="abc-123"
        supersetDomain="https://superset.example.com"
        fetchGuestToken={fetchGuestToken}
      />,
    );

    unmount();
  });
});
