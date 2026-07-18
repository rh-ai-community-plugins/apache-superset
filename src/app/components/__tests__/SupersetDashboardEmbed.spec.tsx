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

  it('renders an error alert when embedDashboard rejects with an Error', async () => {
    (embedDashboard as jest.Mock).mockRejectedValue(new Error('CORS policy violation'));

    render(
      <SupersetDashboardEmbed
        dashboardId="abc-123"
        supersetDomain="https://superset.example.com"
        fetchGuestToken={fetchGuestToken}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('superset-embed-error')).toBeInTheDocument(),
    );
    expect(screen.getByText('Dashboard failed to load')).toBeInTheDocument();
    expect(screen.getByText('CORS policy violation')).toBeInTheDocument();
  });

  it('renders a fallback error message when embedDashboard rejects with a non-Error value', async () => {
    (embedDashboard as jest.Mock).mockRejectedValue('network failure');

    render(
      <SupersetDashboardEmbed
        dashboardId="abc-123"
        supersetDomain="https://superset.example.com"
        fetchGuestToken={fetchGuestToken}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('superset-embed-error')).toBeInTheDocument(),
    );
    expect(screen.getByText('Failed to load dashboard. Please try again.')).toBeInTheDocument();
  });

  it('does not set error state when embedDashboard rejects after component unmount', async () => {
    let rejectEmbed: (err: Error) => void;
    (embedDashboard as jest.Mock).mockReturnValue(
      new Promise((_, reject) => { rejectEmbed = reject; }),
    );

    const { unmount } = render(
      <SupersetDashboardEmbed
        dashboardId="abc-123"
        supersetDomain="https://superset.example.com"
        fetchGuestToken={fetchGuestToken}
      />,
    );

    unmount();

    // Reject after unmount — should not trigger a state update
    rejectEmbed!(new Error('late error'));

    // Give React a tick to process any state updates
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByTestId('superset-embed-error')).not.toBeInTheDocument();
  });

  it('clears the error when dependencies change', async () => {
    (embedDashboard as jest.Mock).mockRejectedValueOnce(new Error('initial error'));

    const { rerender } = render(
      <SupersetDashboardEmbed
        dashboardId="abc-123"
        supersetDomain="https://superset.example.com"
        fetchGuestToken={fetchGuestToken}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('superset-embed-error')).toBeInTheDocument(),
    );

    // Rerender with a new dashboardId — error should clear and container should show
    (embedDashboard as jest.Mock).mockResolvedValue({ unmount: jest.fn() });
    rerender(
      <SupersetDashboardEmbed
        dashboardId="xyz-456"
        supersetDomain="https://superset.example.com"
        fetchGuestToken={fetchGuestToken}
      />,
    );

    await waitFor(() =>
      expect(screen.queryByTestId('superset-embed-error')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('superset-embed-container')).toBeInTheDocument();
  });
});
