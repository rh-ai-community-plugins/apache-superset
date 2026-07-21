import { render, screen } from '@testing-library/react';
import App from '../App';

jest.mock('../pages/InstanceManagementPage', () => {
  const MockPage = () => <div data-testid="instance-page">Instance Management Page</div>;
  MockPage.displayName = 'MockInstanceManagementPage';
  return { __esModule: true, default: MockPage };
});

jest.mock('../pages/EmbeddedDashboardsPage', () => {
  const MockPage = () => <div data-testid="dashboards-page">Embedded Dashboards Page</div>;
  MockPage.displayName = 'MockEmbeddedDashboardsPage';
  return { __esModule: true, default: MockPage };
});

describe('App Component', () => {
  it('should render the routes element', () => {
    render(<App />);
    expect(screen.getByTestId('routes')).toBeInTheDocument();
  });
});
