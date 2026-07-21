import React, { useState, useCallback, useMemo } from 'react';
import {
  Button,
  Card,
  CardBody,
  Checkbox,
  Content,
  ContentVariants,
  FormGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Skeleton,
} from '@patternfly/react-core';
import { DeployForm } from '~/app/components/DeployForm';
import { DeploymentStatusCard } from '~/app/components/DeploymentStatusCard';
import { ProjectSelector } from '~/app/components/ProjectSelector';
import { useSupersetDeployment } from '~/app/hooks/useSupersetDeployment';
import { useSupersetStatus } from '~/app/hooks/useSupersetStatus';
import { useLastSelectedProject } from '~/app/hooks/useLastSelectedProject';
import { useLoadExamples } from '~/app/hooks/useLoadExamples';
import { LoadExamplesModal } from '~/app/components/LoadExamplesModal';

const InstanceManagementPage: React.FC = () => {
  const [selectedProject, setSelectedProject] = useLastSelectedProject();
  const { status, loading: statusLoading, refresh } = useSupersetStatus(selectedProject);
  const { deploy, teardown, deploying, tearing, error: deployError } = useSupersetDeployment();
  const [teardownModalOpen, setTeardownModalOpen] = useState(false);
  const [teardownAcknowledged, setTeardownAcknowledged] = useState(false);
  const [deleteData, setDeleteData] = useState(false);
  const [loadExamplesModalOpen, setLoadExamplesModalOpen] = useState(false);
  const {
    startLoadExamples,
    logs: exampleLogs,
    isRunning: examplesRunning,
    isDone: examplesDone,
    error: examplesError,
    exitCode: examplesExitCode,
    reset: resetExamples,
  } = useLoadExamples();

  const handleDeploy = useCallback(
    async (namespace: string) => {
      const origin = window.location.origin;
      const result = await deploy(namespace, origin);
      if (result) refresh();
    },
    [deploy, refresh],
  );

  const handleLoadExamples = useCallback(() => {
    if (!selectedProject) return;
    resetExamples();
    setLoadExamplesModalOpen(true);
    startLoadExamples(selectedProject);
  }, [selectedProject, startLoadExamples, resetExamples]);

  const handleTeardown = useCallback(async () => {
    if (!selectedProject) return;
    const force = deleteData;
    setTeardownModalOpen(false);
    const result = await teardown(selectedProject, force);
    if (result) refresh();
  }, [selectedProject, teardown, refresh, deleteData]);

  const showDeployForm =
    !statusLoading && (!status || status.phase === 'not-deployed');

  /** Concise status text for screen readers — only updates on meaningful transitions. */
  const statusAnnouncement = useMemo(() => {
    if (!status) return '';
    switch (status.phase) {
      case 'deploying':
        return 'Deploying Superset';
      case 'running':
        return `Superset is running${status.healthy ? ' and healthy' : ''}`;
      case 'error':
        return `Deployment error: ${status.message || 'An error occurred during deployment'}`;
      default:
        return '';
    }
  }, [status?.phase, status?.healthy, status?.message]);

  return (
    <>
      <PageSection hasBodyWrapper={false}>
        <Content component={ContentVariants.h1}>Instance Management</Content>
        <Content component="p">
          Deploy, monitor, and manage your Apache Superset instance.
        </Content>
        <FormGroup fieldId="project-selector" label="Project">
          <ProjectSelector
            selectedProject={selectedProject}
            onSelect={setSelectedProject}
            isDisabled={deploying || tearing}
          />
        </FormGroup>
      </PageSection>

      <PageSection hasBodyWrapper={false}>
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="pf-v6-u-screen-reader"
        >
          {statusAnnouncement}
        </div>
        {statusLoading && !status ? (
          <Card aria-label="Loading status">
            <CardBody>
              <Skeleton screenreaderText="Loading instance status" fontSize="2xl" width="40%" />
              <br />
              <Skeleton width="60%" />
              <br />
              <Skeleton width="30%" />
            </CardBody>
          </Card>
        ) : showDeployForm ? (
          <DeployForm
            selectedProject={selectedProject}
            onDeploy={handleDeploy}
            deploying={deploying}
            error={deployError}
          />
        ) : status ? (
          <DeploymentStatusCard
            status={status}
            loading={statusLoading}
            onTeardown={() => { setTeardownAcknowledged(false); setDeleteData(false); setTeardownModalOpen(true); }}
            onRetry={() => { if (selectedProject) handleDeploy(selectedProject); }}
            tearing={tearing}
            retrying={deploying}
            deployError={deployError}
            onLoadExamples={handleLoadExamples}
            onShowExamplesLog={() => setLoadExamplesModalOpen(true)}
            loadingExamples={examplesRunning}
          />
        ) : null}
      </PageSection>

      <Modal
        variant="small"
        isOpen={teardownModalOpen}
        onClose={() => { setTeardownModalOpen(false); setTeardownAcknowledged(false); setDeleteData(false); }}
        aria-label="Confirm teardown"
      >
        <ModalHeader
          title="Tear down Superset"
        />
        <ModalBody>
          <Content component="p">
            This will delete all Superset resources in project{' '}
            <strong>{selectedProject}</strong> (Deployments, Services,
            ConfigMaps, ServiceAccounts, and Routes).
          </Content>
          <Content component="p">
            The PostgreSQL database and credentials are preserved by default so
            your data can be recovered on a subsequent deploy.
          </Content>
          <Checkbox
            id="teardown-delete-data"
            label="Also delete the PostgreSQL database and credentials (PersistentVolumeClaim and Secret)"
            description="All dashboards and data will be permanently lost."
            isChecked={deleteData}
            onChange={(_event, checked) => { setDeleteData(checked); setTeardownAcknowledged(false); }}
            className="pf-v6-u-mt-md"
          />
          <Checkbox
            id="teardown-acknowledge"
            label={deleteData
              ? 'I understand that all data will be permanently deleted'
              : 'I understand that Superset will be unavailable until redeployed'}
            isChecked={teardownAcknowledged}
            onChange={(_event, checked) => setTeardownAcknowledged(checked)}
            className="pf-v6-u-mt-sm"
          />
        </ModalBody>
        <ModalFooter>
          <Button
            variant="danger"
            onClick={handleTeardown}
            isLoading={tearing}
            isDisabled={tearing || !teardownAcknowledged}
          >
            Tear down
          </Button>
          <Button variant="link" onClick={() => { setTeardownModalOpen(false); setTeardownAcknowledged(false); setDeleteData(false); }}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>

      <LoadExamplesModal
        isOpen={loadExamplesModalOpen}
        onClose={() => setLoadExamplesModalOpen(false)}
        logs={exampleLogs}
        isRunning={examplesRunning}
        isDone={examplesDone}
        error={examplesError}
        exitCode={examplesExitCode}
      />
    </>
  );
};

export default InstanceManagementPage;
