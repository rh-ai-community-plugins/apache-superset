import React from 'react';
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  Gallery,
  Label,
  Split,
  SplitItem,
  Truncate,
} from '@patternfly/react-core';
import { ExternalLinkAltIcon } from '@patternfly/react-icons';
import { SupersetDashboard } from '~/app/types';

export interface DashboardListProps {
  dashboards: SupersetDashboard[];
  supersetUrl?: string;
  onSelect: (dashboard: SupersetDashboard) => void;
}

export const DashboardList: React.FC<DashboardListProps> = ({
  dashboards,
  supersetUrl,
  onSelect,
}) => {
  if (dashboards.length === 0) {
    return (
      <EmptyState
        headingLevel="h3"
        titleText="No dashboards"
      >
        <EmptyStateBody>
          No dashboards are available in this Superset instance.
          {supersetUrl && (
            <>
              {' '}
              <Button
                variant="link"
                isInline
                component="a"
                href={supersetUrl}
                target="_blank"
                rel="noopener noreferrer"
                icon={<ExternalLinkAltIcon />}
                iconPosition="end"
              >
                Open Superset
              </Button>{' '}
              to create your first dashboard.
            </>
          )}
        </EmptyStateBody>
      </EmptyState>
    );
  }

  return (
    <Gallery hasGutter minWidths={{ default: '250px' }} aria-label="Available dashboards">
      {dashboards.map((dashboard) => (
        <Card
          key={dashboard.id}
          data-testid={`dashboard-card-${dashboard.id}`}
        >
          <CardTitle>
            <Split hasGutter>
              <SplitItem isFilled>
                <Button
                  variant="link"
                  isInline
                  onClick={() => onSelect(dashboard)}
                  isDisabled={!dashboard.embeddedId}
                >
                  <Truncate content={dashboard.title} />
                </Button>
              </SplitItem>
              <SplitItem>
                <Label
                  color={dashboard.status === 'published' ? 'green' : 'grey'}
                >
                  {dashboard.status}
                </Label>
              </SplitItem>
            </Split>
          </CardTitle>
          <CardBody>
            {dashboard.embeddedId ? (
              <Label color="blue" isCompact>Embeddable</Label>
            ) : (
              <Label color="orange" isCompact>Not configured for embedding</Label>
            )}
          </CardBody>
        </Card>
      ))}
    </Gallery>
  );
};
