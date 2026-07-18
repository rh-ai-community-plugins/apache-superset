import { render, screen, waitFor } from '@testing-library/react';
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

  it('calls unmount on cleanup when promise has resolved', async () => {
    const unmountFn = jest.fn();
    (embedDashboard as jest.Mock).mockResolvedValue({ unmount: unmountFn });

    const { unmount } = render(
      <SupersetDashboardEmbed
        dashboardId="abc-123"
        supersetDomain="https://superset.example.com"
        fetchGuestToken={fetchGuestToken}
      />,
    );

    await waitFor(() => expect(embedDashboard).toHaveBeenCalled());

    unmount();

    expect(unmountFn).toHaveBeenCalled();
  });

  it('calls unmount immediately when promise resolves after component unmount', async () => {
    let resolveEmbed: (val: { unmount: () => void }) => void;
    const unmountFn = jest.fn();
    (embedDashboard as jest.Mock).mockReturnValue(
      new Promise((resolve) => { resolveEmbed = resolve; }),
    );

    const { unmount } = render(
      <SupersetDashboardEmbed
        dashboardId="abc-123"
        supersetDomain="https://superset.example.com"
        fetchGuestToken={fetchGuestToken}
      />,
    );

    unmount();

    resolveEmbed!({ unmount: unmountFn });
    await waitFor(() => expect(unmountFn).toHaveBeenCalled());
  });
});
