import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoadExamplesModal } from '../LoadExamplesModal';

const defaultProps = {
  isOpen: true,
  onClose: jest.fn(),
  logs: '',
  isRunning: false,
  isDone: false,
  error: null,
  exitCode: null,
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe('LoadExamplesModal', () => {
  it('renders nothing when closed', () => {
    render(<LoadExamplesModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Loading example data')).not.toBeInTheDocument();
  });

  it('shows title when open', () => {
    render(<LoadExamplesModal {...defaultProps} />);
    expect(screen.getByText('Loading example data')).toBeInTheDocument();
  });

  it('shows spinner while running', () => {
    render(<LoadExamplesModal {...defaultProps} isRunning />);
    expect(screen.getByText('Loading examples...')).toBeInTheDocument();
  });

  it('displays log output', () => {
    render(<LoadExamplesModal {...defaultProps} logs="Loading data... Done." />);
    expect(screen.getByText('Loading data... Done.')).toBeInTheDocument();
  });

  it('shows success alert when done with exit code 0', () => {
    render(
      <LoadExamplesModal {...defaultProps} isDone exitCode={0} logs="completed" />,
    );
    expect(screen.getByText('Examples loaded successfully')).toBeInTheDocument();
  });

  it('shows error alert on failure', () => {
    render(
      <LoadExamplesModal {...defaultProps} error="command failed" exitCode={1} />,
    );
    expect(screen.getByText('Load examples failed')).toBeInTheDocument();
    expect(screen.getByText('command failed')).toBeInTheDocument();
  });

  it('calls onClose when Close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<LoadExamplesModal {...defaultProps} onClose={onClose} />);

    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    const footerClose = closeButtons.find((btn) => btn.textContent === 'Close');
    expect(footerClose).toBeDefined();
    await user.click(footerClose!);
    expect(onClose).toHaveBeenCalled();
  });

  it('has a log container with role="log"', () => {
    render(<LoadExamplesModal {...defaultProps} logs="test" />);
    expect(screen.getByRole('log')).toBeInTheDocument();
  });
});
