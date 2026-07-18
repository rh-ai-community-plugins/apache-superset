import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmbeddedDashboardsPage from '../EmbeddedDashboardsPage';
import { ROUTES } from '~/app/routes';
import { useSupersetStatus } from '~/app/hooks/useSupersetStatus';
import { useSupersetDashboards } from '~/app/hooks/useSupersetDashboards';
import { useSupersetGuestToken } from '~/app/hooks/useSupersetGuestToken';
import { useLastSelectedProject } from '~/app/hooks/useLastSelectedProject';

const mockNavigate = jest.fn();
const mockUseParams = jest.fn<Record<string, string>, []>(() => ({ '*': '' }));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useParams: () => mockUseParams(),
}));
jest.mock('~/app/hooks/useSupersetStatus');
jest.mock('~/app/hooks/useSupersetDashboards');
jest.mock('~/app/hooks/useSupersetGuestToken');
jest.mock('~/app/hooks/useLastSelectedProject');
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
jest.mock('~/app/components/SupersetDashboardEmbed', () => ({
  SupersetDashboardEmbed: ({ dashboardId }: { dashboardId: string }) => (
    <div data-testid="superset-embed">{dashboardId}</div>
  ),
}));

describe('EmbeddedDashboardsPage', () => {
  const mockRefreshDashboards = jest.fn();
  const mockFetchGuestToken = jest.fn().mockResolvedValue('token-xyz');

  beforeEach(() => {
    jest.resetAllMocks();
    mockNavigate.mockReset();
    mockUseParams.mockReturnValue({ '*': '' });
    (useLastSelectedProject as jest.Mock).mockReturnValue(['test-ns', jest.fn()]);
    (useSupersetGuestToken as jest.Mock).mockReturnValue(mockFetchGuestToken);
    (useSupersetDashboards as jest.Mock).mockReturnValue({
      dashboards: [],
      loading: false,
      error: null,
      refresh: mockRefreshDashboards,
    });
  });

  describe('List view', () => {
    it('shows select project prompt when no project selected', () => {
      (useLastSelectedProject as jest.Mock).mockReturnValue([null, jest.fn()]);
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: null,
        loading: false,
        error: null,
        refresh: jest.fn(),
      });
      render(<EmbeddedDashboardsPage />);
      expect(screen.getByText('Select a project to view available dashboards.')).toBeInTheDocument();
    });

    it('shows spinner while checking status', () => {
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: null,
        loading: true,
        error: null,
        refresh: jest.fn(),
      });
      render(<EmbeddedDashboardsPage />);
      expect(screen.getByLabelText('Checking Superset status')).toBeInTheDocument();
    });

    it('shows not-running state when Superset is not deployed', () => {
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: { phase: 'not-deployed', healthy: false },
        loading: false,
        error: null,
        refresh: jest.fn(),
      });
      render(<EmbeddedDashboardsPage />);
      expect(screen.getByText('Superset is not running')).toBeInTheDocument();
      expect(screen.getByText('Go to Instance Management')).toBeInTheDocument();
    });

    it('navigates to instance page when clicking Go to Instance Management', async () => {
      const user = userEvent.setup();
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: { phase: 'not-deployed', healthy: false },
        loading: false,
        error: null,
        refresh: jest.fn(),
      });
      render(<EmbeddedDashboardsPage />);
      await user.click(screen.getByText('Go to Instance Management'));
      expect(mockNavigate).toHaveBeenCalledWith(ROUTES.INSTANCE);
    });

    it('shows spinner while loading dashboards', () => {
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: { phase: 'running', healthy: true, url: 'https://superset.example.com' },
        loading: false,
        error: null,
        refresh: jest.fn(),
      });
      (useSupersetDashboards as jest.Mock).mockReturnValue({
        dashboards: [],
        loading: true,
        error: null,
        refresh: mockRefreshDashboards,
      });
      render(<EmbeddedDashboardsPage />);
      expect(screen.getByLabelText('Loading dashboards')).toBeInTheDocument();
    });

    it('shows error when dashboards fail to load', () => {
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: { phase: 'running', healthy: true, url: 'https://superset.example.com' },
        loading: false,
        error: null,
        refresh: jest.fn(),
      });
      (useSupersetDashboards as jest.Mock).mockReturnValue({
        dashboards: [],
        loading: false,
        error: 'Network error',
        refresh: mockRefreshDashboards,
      });
      render(<EmbeddedDashboardsPage />);
      expect(screen.getByText('Failed to load dashboards')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    it('shows empty state when no dashboards available', () => {
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: { phase: 'running', healthy: true, url: 'https://superset.example.com' },
        loading: false,
        error: null,
        refresh: jest.fn(),
      });
      render(<EmbeddedDashboardsPage />);
      expect(screen.getByText('No dashboards')).toBeInTheDocument();
    });

    it('renders dashboard list when dashboards are available', () => {
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: { phase: 'running', healthy: true, url: 'https://superset.example.com' },
        loading: false,
        error: null,
        refresh: jest.fn(),
      });
      (useSupersetDashboards as jest.Mock).mockReturnValue({
        dashboards: [
          { id: 1, title: 'Sales', url: '/d/1/', status: 'published', embeddedId: 'uuid-1' },
        ],
        loading: false,
        error: null,
        refresh: mockRefreshDashboards,
      });
      render(<EmbeddedDashboardsPage />);
      expect(screen.getByText('Sales')).toBeInTheDocument();
    });

    it('navigates to embed view when dashboard is clicked', async () => {
      const user = userEvent.setup();
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: { phase: 'running', healthy: true, url: 'https://superset.example.com' },
        loading: false,
        error: null,
        refresh: jest.fn(),
      });
      (useSupersetDashboards as jest.Mock).mockReturnValue({
        dashboards: [
          { id: 1, title: 'Sales', url: '/d/1/', status: 'published', embeddedId: 'uuid-1' },
        ],
        loading: false,
        error: null,
        refresh: mockRefreshDashboards,
      });
      render(<EmbeddedDashboardsPage />);
      await user.click(screen.getByText('Sales'));
      expect(mockNavigate).toHaveBeenCalledWith('uuid-1');
    });

    it('calls refresh when refresh button is clicked', async () => {
      const user = userEvent.setup();
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: { phase: 'running', healthy: true, url: 'https://superset.example.com' },
        loading: false,
        error: null,
        refresh: jest.fn(),
      });
      render(<EmbeddedDashboardsPage />);
      await user.click(screen.getByLabelText('Refresh dashboards'));
      expect(mockRefreshDashboards).toHaveBeenCalled();
    });
  });

  describe('Embed view', () => {
    beforeEach(() => {
      mockUseParams.mockReturnValue({ '*': 'uuid-123' });
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: { phase: 'running', healthy: true, url: 'https://superset.example.com' },
        loading: false,
        error: null,
        refresh: jest.fn(),
      });
    });

    it('renders embedded dashboard component', () => {
      render(<EmbeddedDashboardsPage />);
      expect(screen.getByTestId('superset-embed')).toBeInTheDocument();
      expect(screen.getByText('uuid-123')).toBeInTheDocument();
    });

    it('shows back button and toolbar', () => {
      render(<EmbeddedDashboardsPage />);
      expect(screen.getByLabelText('Back to dashboard list')).toBeInTheDocument();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    it('navigates back when back button is clicked', async () => {
      const user = userEvent.setup();
      render(<EmbeddedDashboardsPage />);
      await user.click(screen.getByLabelText('Back to dashboard list'));
      expect(mockNavigate).toHaveBeenCalledWith(ROUTES.DASHBOARDS);
    });

    it('shows fullscreen toggle', async () => {
      const user = userEvent.setup();
      render(<EmbeddedDashboardsPage />);
      const fullscreenBtn = screen.getByLabelText('Fullscreen');
      await user.click(fullscreenBtn);
      expect(screen.getAllByLabelText('Exit fullscreen').length).toBeGreaterThanOrEqual(1);
    });

    it('shows open-in-Superset link', () => {
      render(<EmbeddedDashboardsPage />);
      expect(screen.getByText('Open in Superset')).toBeInTheDocument();
    });

    it('shows loading spinner while status is loading', () => {
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: null,
        loading: true,
        error: null,
        refresh: jest.fn(),
      });
      render(<EmbeddedDashboardsPage />);
      expect(screen.getByLabelText('Loading Superset connection')).toBeInTheDocument();
    });

    it('shows not-running state when status loaded but Superset is not running', () => {
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: { phase: 'not-deployed', healthy: false },
        loading: false,
        error: null,
        refresh: jest.fn(),
      });
      render(<EmbeddedDashboardsPage />);
      expect(screen.getByText('Superset is not running')).toBeInTheDocument();
      expect(screen.getByText('Go to Instance Management')).toBeInTheDocument();
      expect(screen.queryByLabelText('Loading Superset connection')).not.toBeInTheDocument();
    });

    it('shows not-running state when status loaded but url is missing', () => {
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: { phase: 'running', healthy: false },
        loading: false,
        error: null,
        refresh: jest.fn(),
      });
      render(<EmbeddedDashboardsPage />);
      expect(screen.getByText('Superset is not running')).toBeInTheDocument();
      expect(screen.queryByLabelText('Loading Superset connection')).not.toBeInTheDocument();
    });

    it('navigates to instance page from not-running state in embed view', async () => {
      const user = userEvent.setup();
      (useSupersetStatus as jest.Mock).mockReturnValue({
        status: { phase: 'not-deployed', healthy: false },
        loading: false,
        error: null,
        refresh: jest.fn(),
      });
      render(<EmbeddedDashboardsPage />);
      await user.click(screen.getByText('Go to Instance Management'));
      expect(mockNavigate).toHaveBeenCalledWith(ROUTES.INSTANCE);
    });
  });
});
