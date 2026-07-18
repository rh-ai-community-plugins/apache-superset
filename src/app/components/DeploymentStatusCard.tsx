import React from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  EmptyState,
  EmptyStateBody,
  Icon,
  Label,
  Progress,
  ProgressMeasureLocation,
  Spinner,
  Split,
  SplitItem,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  ExternalLinkAltIcon,
  InProgressIcon,
} from '@patternfly/react-icons';
import { SupersetStatus } from '~/app/types';

export interface DeploymentStatusCardProps {
  status: SupersetStatus;
  loading?: boolean;
  onTeardown: () => void;
  onRetry: () => void;
  tearing?: boolean;
}

function readyCount(status: SupersetStatus): number {
  let count = 0;
  if (status.resources?.superset?.ready) count++;
  if (status.resources?.postgres?.ready) count++;
  return count;
}

export const DeploymentStatusCard: React.FC<DeploymentStatusCardProps> = ({
  status,
  loading,
  onTeardown,
  onRetry,
  tearing,
}) => {
  if (status.phase === 'deploying') {
    const ready = readyCount(status);
    const total = 2;
    const percent = Math.round((ready / total) * 100);

    return (
      <Card data-testid="deployment-status-card">
        <CardTitle>
          <Split hasGutter>
            <SplitItem>
              <Icon>
                <InProgressIcon />
              </Icon>
            </SplitItem>
            <SplitItem isFilled>Deploying Superset</SplitItem>
          </Split>
        </CardTitle>
        <CardBody>
          <Progress
            value={percent}
            title={`${ready} of ${total} components ready`}
            measureLocation={ProgressMeasureLocation.outside}
            aria-label="Deployment progress"
          />
          {status.message && (
            <p style={{ marginTop: 'var(--pf-t--global--spacer--sm)' }}>
              {status.message}
            </p>
          )}
        </CardBody>
      </Card>
    );
  }

  if (status.phase === 'running') {
    return (
      <Card data-testid="deployment-status-card">
        <CardTitle>
          <Split hasGutter>
            <SplitItem>
              <Icon status="success">
                <CheckCircleIcon />
              </Icon>
            </SplitItem>
            <SplitItem isFilled>Superset is running</SplitItem>
            <SplitItem>
              <Label color="green">Healthy</Label>
            </SplitItem>
          </Split>
        </CardTitle>
        <CardBody>
          <DescriptionList isHorizontal>
            {status.version && (
              <DescriptionListGroup>
                <DescriptionListTerm>Version</DescriptionListTerm>
                <DescriptionListDescription>
                  {status.version}
                </DescriptionListDescription>
              </DescriptionListGroup>
            )}
            {status.url && (
              <DescriptionListGroup>
                <DescriptionListTerm>URL</DescriptionListTerm>
                <DescriptionListDescription>
                  <Button
                    variant="link"
                    isInline
                    component="a"
                    href={status.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    icon={<ExternalLinkAltIcon />}
                    iconPosition="end"
                  >
                    {status.url}
                  </Button>
                </DescriptionListDescription>
              </DescriptionListGroup>
            )}
            {status.resources && (
              <>
                <DescriptionListGroup>
                  <DescriptionListTerm>Superset</DescriptionListTerm>
                  <DescriptionListDescription>
                    {status.resources.superset.readyReplicas ?? 0}/
                    {status.resources.superset.replicas ?? 1} replicas ready
                  </DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>PostgreSQL</DescriptionListTerm>
                  <DescriptionListDescription>
                    {status.resources.postgres.readyReplicas ?? 0}/
                    {status.resources.postgres.replicas ?? 1} replicas ready
                  </DescriptionListDescription>
                </DescriptionListGroup>
              </>
            )}
          </DescriptionList>
          <div style={{ marginTop: 'var(--pf-t--global--spacer--md)' }}>
            <Button
              variant="danger"
              onClick={onTeardown}
              isLoading={tearing}
              isDisabled={tearing}
            >
              Tear down
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (status.phase === 'error') {
    return (
      <Card data-testid="deployment-status-card">
        <CardBody>
          <Alert
            variant="danger"
            title="Deployment error"
            isInline
            actionLinks={
              <>
                <Button variant="link" isInline onClick={onRetry}>
                  Retry
                </Button>
                <Button
                  variant="link"
                  isInline
                  isDanger
                  onClick={onTeardown}
                  isLoading={tearing}
                  isDisabled={tearing}
                >
                  Tear down
                </Button>
              </>
            }
          >
            {status.message || 'An error occurred during deployment.'}
          </Alert>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card data-testid="deployment-status-card">
      <CardBody>
        <EmptyState
          headingLevel="h3"
          titleText="No Superset instance"
          icon={loading ? Spinner : undefined}
        >
          <EmptyStateBody>
            Deploy Apache Superset to this project to start creating and embedding
            dashboards.
          </EmptyStateBody>
        </EmptyState>
      </CardBody>
    </Card>
  );
};
