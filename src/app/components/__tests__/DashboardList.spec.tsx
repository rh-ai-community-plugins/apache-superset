import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardList } from '../DashboardList';
import { SupersetDashboard } from '~/app/types';

describe('DashboardList', () => {
  const onSelect = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
  });

  const dashboards: SupersetDashboard[] = [
    {
      id: 1,
      title: 'Sales Dashboard',
      url: '/superset/dashboard/1/',
      status: 'published',
      embeddedId: 'abc-123',
    },
    {
      id: 2,
      title: 'Analytics',
      url: '/superset/dashboard/2/',
      status: 'draft',
    },
  ];

  it('shows empty state when no dashboards', () => {
    render(
      <DashboardList
        dashboards={[]}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText('No dashboards')).toBeInTheDocument();
  });

  it('shows link to Superset when empty and supersetUrl provided', () => {
    render(
      <DashboardList
        dashboards={[]}
        supersetUrl="https://superset.example.com"
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText('Open Superset')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open superset/i }))
      .toHaveAttribute('href', 'https://superset.example.com');
  });

  it('renders dashboard cards', () => {
    render(
      <DashboardList
        dashboards={dashboards}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText('Sales Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('published')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
  });

  it('shows embeddable label for dashboards with embeddedId', () => {
    render(
      <DashboardList
        dashboards={dashboards}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText('Embeddable')).toBeInTheDocument();
    expect(screen.getByText('Not configured for embedding')).toBeInTheDocument();
  });

  it('calls onSelect when embeddable dashboard title is clicked', async () => {
    const user = userEvent.setup();
    render(
      <DashboardList
        dashboards={dashboards}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByText('Sales Dashboard'));
    expect(onSelect).toHaveBeenCalledWith(dashboards[0]);
  });

  it('disables button for non-embeddable dashboards', () => {
    render(
      <DashboardList
        dashboards={dashboards}
        onSelect={onSelect}
      />,
    );
    const analyticsBtn = screen.getByText('Analytics').closest('button');
    expect(analyticsBtn).toBeDisabled();
  });
});
