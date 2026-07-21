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
  InputGroup,
  InputGroupItem,
  Label,
  Progress,
  ProgressMeasureLocation,
  Spinner,
  Split,
  SplitItem,
  TextInput,
  Tooltip,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  CopyIcon,
  ExternalLinkAltIcon,
  EyeIcon,
  EyeSlashIcon,
  InProgressIcon,
  CubesIcon,
} from '@patternfly/react-icons';
import { SupersetStatus } from '~/app/types';

export interface DeploymentStatusCardProps {
  status: SupersetStatus;
  loading?: boolean;
  onTeardown: () => void;
  onRetry: () => void;
  tearing?: boolean;
  retrying?: boolean;
  deployError?: string | null;
  onLoadExamples?: () => void;
  onShowExamplesLog?: () => void;
  loadingExamples?: boolean;
}

function isSafeUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://');
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
  retrying,
  deployError,
  onLoadExamples,
  onShowExamplesLog,
  loadingExamples,
}) => {
  const [passwordVisible, setPasswordVisible] = React.useState(false);
  const [copiedField, setCopiedField] = React.useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField(null), 1500);
  };

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
            <p className="pf-v6-u-mt-sm">
              {status.message}
            </p>
          )}
          <div className="pf-v6-u-mt-md">
            <Button
              variant="danger"
              onClick={onTeardown}
              isLoading={tearing}
              isDisabled={tearing}
            >
              Abort deployment
            </Button>
          </div>
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
                  {isSafeUrl(status.url) ? (
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
                  ) : (
                    <span>{status.url}</span>
                  )}
                </DescriptionListDescription>
              </DescriptionListGroup>
            )}
            {status.credentials && (
              <>
                <DescriptionListGroup>
                  <DescriptionListTerm>Username</DescriptionListTerm>
                  <DescriptionListDescription>
                    <div style={{ maxWidth: '300px' }}>
                      <InputGroup>
                        <InputGroupItem isFill>
                          <TextInput
                            readOnly
                            value={status.credentials.username}
                            type="text"
                            aria-label="Username"
                          />
                        </InputGroupItem>
                        <InputGroupItem>
                          <Tooltip content={copiedField === 'username' ? 'Copied' : 'Copy username'}>
                            <Button
                              variant="control"
                              aria-label="Copy username"
                              onClick={() => copyToClipboard(status.credentials!.username, 'username')}
                              icon={<CopyIcon />}
                            />
                          </Tooltip>
                        </InputGroupItem>
                      </InputGroup>
                    </div>
                  </DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Password</DescriptionListTerm>
                  <DescriptionListDescription>
                    <div style={{ maxWidth: '300px' }}>
                      <InputGroup>
                        <InputGroupItem isFill>
                          <TextInput
                            readOnly
                            value={passwordVisible ? status.credentials.password : '•'.repeat(12)}
                            type={passwordVisible ? 'text' : 'password'}
                            aria-label="Password"
                          />
                        </InputGroupItem>
                        <InputGroupItem>
                          <Tooltip content={passwordVisible ? 'Hide password' : 'Show password'}>
                            <Button
                              variant="control"
                              aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                              onClick={() => setPasswordVisible((prev) => !prev)}
                              icon={passwordVisible ? <EyeSlashIcon /> : <EyeIcon />}
                            />
                          </Tooltip>
                        </InputGroupItem>
                        <InputGroupItem>
                          <Tooltip content={copiedField === 'password' ? 'Copied' : 'Copy password'}>
                            <Button
                              variant="control"
                              aria-label="Copy password"
                              onClick={() => copyToClipboard(status.credentials!.password, 'password')}
                              icon={<CopyIcon />}
                            />
                          </Tooltip>
                        </InputGroupItem>
                      </InputGroup>
                    </div>
                  </DescriptionListDescription>
                </DescriptionListGroup>
              </>
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
          <div className="pf-v6-u-mt-md">
            <Split hasGutter>
              {onLoadExamples && !loadingExamples && (
                <SplitItem>
                  <Button
                    variant="secondary"
                    icon={<CubesIcon />}
                    onClick={onLoadExamples}
                    isDisabled={tearing}
                  >
                    Load examples
                  </Button>
                </SplitItem>
              )}
              {loadingExamples && onShowExamplesLog && (
                <SplitItem>
                  <Button
                    variant="secondary"
                    onClick={onShowExamplesLog}
                    isDisabled={tearing}
                  >
                    Show logs
                  </Button>
                </SplitItem>
              )}
              <SplitItem>
                <Button
                  variant="danger"
                  onClick={onTeardown}
                  isLoading={tearing}
                  isDisabled={tearing}
                >
                  Tear down
                </Button>
              </SplitItem>
            </Split>
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
                <Button
                  variant="link"
                  isInline
                  onClick={onRetry}
                  isLoading={retrying}
                  isDisabled={retrying || tearing}
                >
                  Retry
                </Button>
                <Button
                  variant="link"
                  isInline
                  isDanger
                  onClick={onTeardown}
                  isLoading={tearing}
                  isDisabled={tearing || retrying}
                >
                  Tear down
                </Button>
              </>
            }
          >
            {status.message || 'An error occurred during deployment.'}
          </Alert>
          {deployError && (
            <Alert
              variant="danger"
              title="Deploy request failed"
              isInline
              className="pf-v6-u-mt-sm"
            >
              {deployError}
            </Alert>
          )}
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
