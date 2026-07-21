import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeployForm, DeployFormProps } from '../DeployForm';
import { useAccessReview } from '~/app/hooks/useAccessReview';

jest.mock('~/app/hooks/useAccessReview');

const allAllowed = [
  { verb: 'create', resource: 'deployments', group: 'apps', allowed: true },
  { verb: 'create', resource: 'services', group: '', allowed: true },
  { verb: 'create', resource: 'configmaps', group: '', allowed: true },
  { verb: 'create', resource: 'secrets', group: '', allowed: true },
];

const someDenied = [
  { verb: 'create', resource: 'deployments', group: 'apps', allowed: true },
  { verb: 'create', resource: 'services', group: '', allowed: true },
  { verb: 'create', resource: 'configmaps', group: '', allowed: false },
  { verb: 'create', resource: 'secrets', group: '', allowed: false },
];

describe('DeployForm', () => {
  const onDeploy = jest.fn();

  const defaultProps: DeployFormProps = {
    selectedProject: 'test-ns',
    onDeploy,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    (useAccessReview as jest.Mock).mockReturnValue({
      results: allAllowed,
      loading: false,
      error: null,
    });
  });

  it('renders the deploy form', () => {
    render(<DeployForm {...defaultProps} />);
    expect(screen.getByTestId('deploy-form')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deploy superset/i })).toBeInTheDocument();
  });

  it('enables deploy button when all permissions are allowed', () => {
    render(<DeployForm {...defaultProps} />);
    expect(screen.getByRole('button', { name: /deploy superset/i })).toBeEnabled();
  });

  it('disables deploy button when permissions are denied', () => {
    (useAccessReview as jest.Mock).mockReturnValue({
      results: someDenied,
      loading: false,
      error: null,
    });
    render(<DeployForm {...defaultProps} />);
    expect(screen.getByRole('button', { name: /deploy superset/i })).toBeDisabled();
  });

  it('disables deploy button when no project is selected', () => {
    (useAccessReview as jest.Mock).mockReturnValue({
      results: [],
      loading: false,
      error: null,
    });
    render(<DeployForm {...defaultProps} selectedProject={null} />);
    expect(screen.getByRole('button', { name: /deploy superset/i })).toBeDisabled();
  });

  it('disables deploy button when RBAC returns no create-verb results (vacuous truth guard)', () => {
    // Results contain only non-create verbs — filtering to create-verb yields an empty array.
    // Array.every() on an empty array is vacuously true, so without the length guard the
    // button would be incorrectly enabled.
    (useAccessReview as jest.Mock).mockReturnValue({
      results: [{ verb: 'get', resource: 'deployments', group: 'apps', allowed: true }],
      loading: false,
      error: null,
    });
    render(<DeployForm {...defaultProps} />);
    expect(screen.getByRole('button', { name: /deploy superset/i })).toBeDisabled();
  });

  it('shows confirmation modal on deploy click', async () => {
    const user = userEvent.setup();
    render(<DeployForm {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /deploy superset/i }));
    expect(screen.getByRole('heading', { name: /deploy apache superset/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
  });

  it('calls onDeploy after confirmation', async () => {
    const user = userEvent.setup();
    render(<DeployForm {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /deploy superset/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onDeploy).toHaveBeenCalledWith('test-ns');
  });

  it('shows RBAC loading spinner', () => {
    (useAccessReview as jest.Mock).mockReturnValue({
      results: [],
      loading: true,
      error: null,
    });
    render(<DeployForm {...defaultProps} />);
    expect(screen.getByLabelText('Checking permissions')).toBeInTheDocument();
  });

  it('displays error alert when error prop is set', () => {
    render(<DeployForm {...defaultProps} error="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('disables deploy button while deploying', () => {
    render(<DeployForm {...defaultProps} deploying />);
    expect(screen.getByRole('button', { name: /deploy superset/i })).toBeDisabled();
  });
});
