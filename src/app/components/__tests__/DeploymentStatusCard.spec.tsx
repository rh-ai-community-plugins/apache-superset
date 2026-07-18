import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeploymentStatusCard } from '../DeploymentStatusCard';
import { SupersetStatus } from '~/app/types';

describe('DeploymentStatusCard', () => {
  const onTeardown = jest.fn();
  const onRetry = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('shows empty state for not-deployed phase', () => {
    const status: SupersetStatus = { phase: 'not-deployed', healthy: false };
    render(
      <DeploymentStatusCard
        status={status}
        onTeardown={onTeardown}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('No Superset instance')).toBeInTheDocument();
  });

  it('shows progress bar during deploying phase', () => {
    const status: SupersetStatus = {
      phase: 'deploying',
      healthy: false,
      resources: {
        superset: { ready: false, replicas: 1, readyReplicas: 0 },
        postgres: { ready: true, replicas: 1, readyReplicas: 1 },
      },
    };
    render(
      <DeploymentStatusCard
        status={status}
        onTeardown={onTeardown}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Deploying Superset')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 components ready')).toBeInTheDocument();
  });

  it('shows status details when running', () => {
    const status: SupersetStatus = {
      phase: 'running',
      healthy: true,
      version: '4.1.1',
      url: 'https://superset.example.com',
      resources: {
        superset: { ready: true, replicas: 1, readyReplicas: 1 },
        postgres: { ready: true, replicas: 1, readyReplicas: 1 },
      },
    };
    render(
      <DeploymentStatusCard
        status={status}
        onTeardown={onTeardown}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Superset is running')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('4.1.1')).toBeInTheDocument();
    expect(screen.getByText('https://superset.example.com')).toBeInTheDocument();
  });

  it('shows teardown button when running', async () => {
    const user = userEvent.setup();
    const status: SupersetStatus = {
      phase: 'running',
      healthy: true,
      resources: {
        superset: { ready: true },
        postgres: { ready: true },
      },
    };
    render(
      <DeploymentStatusCard
        status={status}
        onTeardown={onTeardown}
        onRetry={onRetry}
      />,
    );
    const teardownBtn = screen.getByRole('button', { name: /tear down/i });
    await user.click(teardownBtn);
    expect(onTeardown).toHaveBeenCalledTimes(1);
  });

  it('shows error alert with retry and teardown', async () => {
    const user = userEvent.setup();
    const status: SupersetStatus = {
      phase: 'error',
      healthy: false,
      message: 'Pod crash loop',
    };
    render(
      <DeploymentStatusCard
        status={status}
        onTeardown={onTeardown}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Deployment error')).toBeInTheDocument();
    expect(screen.getByText('Pod crash loop')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /tear down/i }));
    expect(onTeardown).toHaveBeenCalledTimes(1);
  });

  it('disables teardown button while tearing', () => {
    const status: SupersetStatus = {
      phase: 'running',
      healthy: true,
      resources: {
        superset: { ready: true },
        postgres: { ready: true },
      },
    };
    render(
      <DeploymentStatusCard
        status={status}
        onTeardown={onTeardown}
        onRetry={onRetry}
        tearing
      />,
    );
    const teardownBtn = screen.getByRole('button', { name: /tear down/i });
    expect(teardownBtn).toBeDisabled();
  });
});
