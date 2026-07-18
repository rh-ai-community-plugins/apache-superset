import { render, screen, waitFor } from '@testing-library/react';
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

  it('shows loading spinner while checking status', () => {
    (useSupersetStatus as jest.Mock).mockReturnValue({
      status: null,
      loading: true,
      error: null,
      refresh: mockRefresh,
    });
    render(<InstanceManagementPage />);
    expect(screen.getByLabelText('Loading status')).toBeInTheDocument();
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
    expect(screen.getByText('Deploying Superset')).toBeInTheDocument();
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
    expect(screen.getByText(/permanently lost/i)).toBeInTheDocument();
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

    const confirmButtons = screen.getAllByRole('button', { name: /tear down/i });
    const modalTeardown = confirmButtons.find(
      (btn) => btn.closest('.pf-v6-c-modal-box') !== null,
    );
    if (modalTeardown) {
      await user.click(modalTeardown);
    }

    await waitFor(() => {
      expect(mockTeardown).toHaveBeenCalledWith('test-ns');
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
});
