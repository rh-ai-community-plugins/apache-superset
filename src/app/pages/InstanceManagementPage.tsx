import React, { useState, useCallback } from 'react';
import {
  Button,
  Content,
  ContentVariants,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Spinner,
} from '@patternfly/react-core';
import { DeployForm } from '~/app/components/DeployForm';
import { DeploymentStatusCard } from '~/app/components/DeploymentStatusCard';
import { useSupersetDeployment } from '~/app/hooks/useSupersetDeployment';
import { useSupersetStatus } from '~/app/hooks/useSupersetStatus';
import { useLastSelectedProject } from '~/app/hooks/useLastSelectedProject';

const InstanceManagementPage: React.FC = () => {
  const [selectedProject, setSelectedProject] = useLastSelectedProject();
  const { status, loading: statusLoading, refresh } = useSupersetStatus(selectedProject);
  const { deploy, teardown, deploying, tearing, error: deployError } = useSupersetDeployment();
  const [teardownModalOpen, setTeardownModalOpen] = useState(false);

  const handleDeploy = useCallback(
    async (namespace: string) => {
      const origin = window.location.origin;
      const result = await deploy(namespace, origin);
      if (result) refresh();
    },
    [deploy, refresh],
  );

  const handleTeardown = useCallback(async () => {
    if (!selectedProject) return;
    setTeardownModalOpen(false);
    const result = await teardown(selectedProject);
    if (result) refresh();
  }, [selectedProject, teardown, refresh]);

  const showDeployForm =
    !statusLoading && (!status || status.phase === 'not-deployed');

  return (
    <>
      <PageSection hasBodyWrapper={false}>
        <Content component={ContentVariants.h1}>Instance Management</Content>
        <Content component="p">
          Deploy, monitor, and manage your Apache Superset instance.
        </Content>
      </PageSection>

      <PageSection hasBodyWrapper={false}>
        {statusLoading && !status ? (
          <Spinner aria-label="Loading status" />
        ) : showDeployForm ? (
          <DeployForm
            selectedProject={selectedProject}
            onProjectSelect={setSelectedProject}
            onDeploy={handleDeploy}
            deploying={deploying}
            error={deployError}
          />
        ) : status ? (
          <DeploymentStatusCard
            status={status}
            loading={statusLoading}
            onTeardown={() => setTeardownModalOpen(true)}
            onRetry={() => { if (selectedProject) handleDeploy(selectedProject); }}
            tearing={tearing}
          />
        ) : null}
      </PageSection>

      <Modal
        variant="small"
        isOpen={teardownModalOpen}
        onClose={() => setTeardownModalOpen(false)}
        aria-label="Confirm teardown"
      >
        <ModalHeader
          title="Tear down Superset"
        />
        <ModalBody>
          This will delete all Superset resources in project{' '}
          <strong>{selectedProject}</strong>, including the PostgreSQL
          PersistentVolumeClaim.{' '}
          <strong>All dashboards and data will be permanently lost.</strong>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="danger"
            onClick={handleTeardown}
            isLoading={tearing}
            isDisabled={tearing}
          >
            Tear down
          </Button>
          <Button variant="link" onClick={() => setTeardownModalOpen(false)}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
};

export default InstanceManagementPage;
