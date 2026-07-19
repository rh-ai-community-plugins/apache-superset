import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmbedErrorBoundary } from '../EmbedErrorBoundary';

const ThrowingChild = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) throw new Error('render crash');
  return <div>OK</div>;
};

const RecoverableWrapper = ({ onReset }: { onReset?: () => void }) => {
  const [shouldThrow, setShouldThrow] = useState(true);
  return (
    <EmbedErrorBoundary
      onReset={() => {
        setShouldThrow(false);
        onReset?.();
      }}
    >
      <ThrowingChild shouldThrow={shouldThrow} />
    </EmbedErrorBoundary>
  );
};

describe('EmbedErrorBoundary', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('renders children when no error occurs', () => {
    render(
      <EmbedErrorBoundary>
        <div>child content</div>
      </EmbedErrorBoundary>,
    );
    expect(screen.getByText('child content')).toBeInTheDocument();
  });

  it('shows error state when child throws during render', () => {
    render(
      <EmbedErrorBoundary>
        <ThrowingChild shouldThrow />
      </EmbedErrorBoundary>,
    );
    expect(screen.getByText('Dashboard failed to render')).toBeInTheDocument();
    expect(screen.getByText('render crash')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('recovers when "Try again" is clicked', async () => {
    const user = userEvent.setup();
    render(<RecoverableWrapper />);
    expect(screen.getByText('Dashboard failed to render')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('OK')).toBeInTheDocument();
  });

  it('calls onReset callback when provided', async () => {
    const user = userEvent.setup();
    const onReset = jest.fn();
    render(<RecoverableWrapper onReset={onReset} />);
    expect(screen.getByText('Dashboard failed to render')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
