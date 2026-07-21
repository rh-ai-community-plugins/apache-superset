import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InstanceManagementPage from '../InstanceManagementPage';
import { useSupersetStatus } from '~/app/hooks/useSupersetStatus';
import { useSupersetDeployment } from '~/app/hooks/useSupersetDeployment';
import { useLastSelectedProject } from '~/app/hooks/useLastSelectedProject';

jest.mock('~/app/hooks/useSupersetStatus');
jest.mock('~/app/hooks/useSupersetDeployment');
jest.mock('~/app/hooks/useLastSelectedProject');
jest.mock('~/app/hooks/useAccessReview', () => ({
  useAccessReview: () => ({
    results: [
      { verb: 'create', resource: 'deployments', group: 'apps', allowed: true },
      { verb: 'create', resource: 'services', group: '', allowed: true },
      { verb: 'create', resource: 'configmaps', group: '', allowed: true },
      { verb: 'create', resource: 'secrets', group: '', allowed: true },
    ],
    loading: false,
    error: null,
  }),
}));
jest.mock('~/app/components/ProjectSelector', () => ({
  ProjectSelector: ({
    selectedProject,
    onSelect,
  }: {
    selectedProject: string | null;
    onSelect: (p: string | null) => void;
  }) => (
    <button data-testid="project-selector" onClick={() => onSelect('test-ns')}>
      {selectedProject || 'Select a project'}
    </button>
  ),
}));

describe('InstanceManagementPage', () => {
  let mockDeploy: jest.Mock;
  let mockTeardown: jest.Mock;
  const mockRefresh = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    mockDeploy = jest.fn().mockResolvedValue({ message: 'ok' });
    mockTeardown = jest.fn().mockResolvedValue({ message: 'ok' });
    (useLastSelectedProject as jest.Mock).mockReturnValue(['test-ns', jest.fn()]);
    (useSupersetDeployment as jest.Mock).mockReturnValue({
      deploy: mockDeploy,
      teardown: mockTeardown,
      deploying: false,
      tearing: false,
      error: null,
    });
  });

  it('shows loading skeleton while checking status', () => {
    (useSupersetStatus as jest.Mock).mockReturnValue({
      status: null,
      loading: true,
      error: null,
      refresh: mockRefresh,
    });
    render(<InstanceManagementPage />);
    expect(screen.getByLabelText('Loading status')).toBeInTheDocument();
    expect(screen.getByText('Loading instance status')).toBeInTheDocument();
  });

  it('shows deploy form when not deployed', () => {
    (useSupersetStatus as jest.Mock).mockReturnValue({
      status: { phase: 'not-deployed', healthy: false },
      loading: false,
      error: null,
      refresh: mockRefresh,
    });
    render(<InstanceManagementPage />);
    expect(screen.getByTestId('deploy-form')).toBeInTheDocument();
  });

  it('shows status card when deploying', () => {
    (useSupersetStatus as jest.Mock).mockReturnValue({
      status: {
        phase: 'deploying',
        healthy: false,
        resources: {
          superset: { ready: false },
          postgres: { ready: false },
        },
      },
      loading: false,
      error: null,
      refresh: mockRefresh,
    });
    render(<InstanceManagementPage />);
    expect(screen.getByTestId('deployment-status-card')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('deployment-status-card')).getByText('Deploying Superset'),
    ).toBeInTheDocument();
  });

  it('shows status card when running', () => {
    (useSupersetStatus as jest.Mock).mockReturnValue({
      status: {
        phase: 'running',
        healthy: true,
        version: '4.1.1',
        resources: {
          superset: { ready: true, replicas: 1, readyReplicas: 1 },
          postgres: { ready: true, replicas: 1, readyReplicas: 1 },
        },
      },
      loading: false,
      error: null,
      refresh: mockRefresh,
    });
    render(<InstanceManagementPage />);
    expect(screen.getByText('Superset is running')).toBeInTheDocument();
  });

  it('shows teardown confirmation modal with data loss warning', async () => {
    const user = userEvent.setup();
    (useSupersetStatus as jest.Mock).mockReturnValue({
      status: {
        phase: 'running',
        healthy: true,
        resources: {
          superset: { ready: true },
          postgres: { ready: true },
        },
      },
      loading: false,
      error: null,
      refresh: mockRefresh,
    });
    render(<InstanceManagementPage />);

    await user.click(screen.getByRole('button', { name: /tear down/i }));
    expect(screen.getByText(/unavailable until redeployed/i)).toBeInTheDocument();
  });

  it('calls teardown on modal confirm', async () => {
    const user = userEvent.setup();
    (useSupersetStatus as jest.Mock).mockReturnValue({
      status: {
        phase: 'running',
        healthy: true,
        resources: {
          superset: { ready: true },
          postgres: { ready: true },
        },
      },
      loading: false,
      error: null,
      refresh: mockRefresh,
    });
    render(<InstanceManagementPage />);

    await user.click(screen.getByRole('button', { name: /tear down/i }));

    const modal = screen.getByLabelText('Confirm teardown');
    await user.click(within(modal).getByLabelText(/I understand that Superset will be unavailable/i));
    await user.click(within(modal).getByRole('button', { name: /tear down/i }));

    await waitFor(() => {
      expect(mockTeardown).toHaveBeenCalledWith('test-ns', false);
    });
  });

  it('passes force=true when delete data checkbox is checked', async () => {
    const user = userEvent.setup();
    (useSupersetStatus as jest.Mock).mockReturnValue({
      status: {
        phase: 'running',
        healthy: true,
        resources: {
          superset: { ready: true },
          postgres: { ready: true },
        },
      },
      loading: false,
      error: null,
      refresh: mockRefresh,
    });
    render(<InstanceManagementPage />);

    await user.click(screen.getByRole('button', { name: /tear down/i }));

    const modal = screen.getByLabelText('Confirm teardown');
    await user.click(within(modal).getByLabelText(/Also delete the PostgreSQL/i));
    await user.click(within(modal).getByLabelText(/I understand that all data will be permanently/i));
    await user.click(within(modal).getByRole('button', { name: /tear down/i }));

    await waitFor(() => {
      expect(mockTeardown).toHaveBeenCalledWith('test-ns', true);
    });
  });

  it('shows teardown modal when abort is clicked during deploying phase', async () => {
    const user = userEvent.setup();
    (useSupersetStatus as jest.Mock).mockReturnValue({
      status: {
        phase: 'deploying',
        healthy: false,
        resources: {
          superset: { ready: false },
          postgres: { ready: false },
        },
      },
      loading: false,
      error: null,
      refresh: mockRefresh,
    });
    render(<InstanceManagementPage />);

    await user.click(screen.getByRole('button', { name: /abort deployment/i }));

    const modal = screen.getByLabelText('Confirm teardown');
    expect(modal).toBeInTheDocument();

    await user.click(within(modal).getByLabelText(/I understand that Superset will be unavailable/i));
    await user.click(within(modal).getByRole('button', { name: /tear down/i }));

    await waitFor(() => {
      expect(mockTeardown).toHaveBeenCalledWith('test-ns', false);
    });
  });

  it('shows error state with retry', () => {
    (useSupersetStatus as jest.Mock).mockReturnValue({
      status: {
        phase: 'error',
        healthy: false,
        message: 'Init failed',
      },
      loading: false,
      error: null,
      refresh: mockRefresh,
    });
    render(<InstanceManagementPage />);
    expect(screen.getByText('Deployment error')).toBeInTheDocument();
    expect(screen.getByText('Init failed')).toBeInTheDocument();
  });

  it('disables and shows loading on Retry button while retrying', () => {
    (useSupersetStatus as jest.Mock).mockReturnValue({
      status: { phase: 'error', healthy: false, message: 'Init failed' },
      loading: false,
      error: null,
      refresh: mockRefresh,
    });
    (useSupersetDeployment as jest.Mock).mockReturnValue({
      deploy: mockDeploy,
      teardown: mockTeardown,
      deploying: true,
      tearing: false,
      error: null,
    });
    render(<InstanceManagementPage />);
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeDisabled();
  });

  it('calls deploy when Retry is clicked from error state', async () => {
    const user = userEvent.setup();
    (useSupersetStatus as jest.Mock).mockReturnValue({
      status: { phase: 'error', healthy: false, message: 'Init failed' },
      loading: false,
      error: null,
      refresh: mockRefresh,
    });
    render(<InstanceManagementPage />);

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(mockDeploy).toHaveBeenCalledWith('test-ns', expect.any(String));
    });
  });

  it('shows deployError alert when a retry fails', () => {
    (useSupersetStatus as jest.Mock).mockReturnValue({
      status: { phase: 'error', healthy: false, message: 'Init failed' },
      loading: false,
      error: null,
      refresh: mockRefresh,
    });
    (useSupersetDeployment as jest.Mock).mockReturnValue({
      deploy: mockDeploy,
      teardown: mockTeardown,
      deploying: false,
      tearing: false,
      error: 'Network error during retry',
    });
    render(<InstanceManagementPage />);
    expect(screen.getByText('Deploy request failed')).toBeInTheDocument();
    expect(screen.getByText('Network error during retry')).toBeInTheDocument();
  });

  it('shows page heading', () => {
    (useSupersetStatus as jest.Mock).mockReturnValue({
      status: null,
      loading: false,
      error: null,
      refresh: mockRefresh,
    });
    render(<InstanceManagementPage />);
    expect(screen.getByText('Instance Management')).toBeInTheDocument();
  });

  describe('aria-live status announcements', () => {
    it('has a narrowed aria-live region with role="status"', () => {
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: { phase: 'running', healthy: true },
        loading: false,
        error: null,
        refresh: mockRefresh,
      });
      render(<InstanceManagementPage />);
      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
      expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    });

    it('announces "Deploying Superset" during deploying phase', () => {
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: {
          phase: 'deploying',
          healthy: false,
          resources: {
            superset: { ready: false },
            postgres: { ready: false },
          },
        },
        loading: false,
        error: null,
        refresh: mockRefresh,
      });
      render(<InstanceManagementPage />);
      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toHaveTextContent('Deploying Superset');
    });

    it('announces "Superset is running and healthy" when running and healthy', () => {
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: {
          phase: 'running',
          healthy: true,
          resources: {
            superset: { ready: true },
            postgres: { ready: true },
          },
        },
        loading: false,
        error: null,
        refresh: mockRefresh,
      });
      render(<InstanceManagementPage />);
      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toHaveTextContent('Superset is running and healthy');
    });

    it('announces "Superset is running" without "healthy" when not healthy', () => {
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: {
          phase: 'running',
          healthy: false,
          resources: {
            superset: { ready: true },
            postgres: { ready: true },
          },
        },
        loading: false,
        error: null,
        refresh: mockRefresh,
      });
      render(<InstanceManagementPage />);
      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toHaveTextContent('Superset is running');
      expect(liveRegion).not.toHaveTextContent('healthy');
    });

    it('announces deployment error with message', () => {
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: {
          phase: 'error',
          healthy: false,
          message: 'Pod crash loop',
        },
        loading: false,
        error: null,
        refresh: mockRefresh,
      });
      render(<InstanceManagementPage />);
      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toHaveTextContent('Deployment error: Pod crash loop');
    });

    it('has empty status announcement when loading with no status', () => {
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: null,
        loading: true,
        error: null,
        refresh: mockRefresh,
      });
      render(<InstanceManagementPage />);
      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toHaveTextContent('');
    });

    it('has empty status announcement for not-deployed phase', () => {
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: { phase: 'not-deployed', healthy: false },
        loading: false,
        error: null,
        refresh: mockRefresh,
      });
      render(<InstanceManagementPage />);
      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toHaveTextContent('');
    });
  });
});
