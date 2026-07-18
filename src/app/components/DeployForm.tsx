import React, { useState, useMemo } from 'react';
import {
  ActionGroup,
  Alert,
  Button,
  Form,
  FormGroup,
  FormSection,
  Icon,
  List,
  ListItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  TimesCircleIcon,
} from '@patternfly/react-icons';
import { ProjectSelector } from '~/app/components/ProjectSelector';
import { useAccessReview, AccessReviewResult } from '~/app/hooks/useAccessReview';
import { useLastSelectedProject } from '~/app/hooks/useLastSelectedProject';

export interface DeployFormProps {
  onDeploy: (namespace: string) => void;
  deploying?: boolean;
  error?: string | null;
}

function hasRequiredPermissions(results: AccessReviewResult[]): boolean {
  return results
    .filter((r) => r.verb === 'create')
    .every((r) => r.allowed);
}

export const DeployForm: React.FC<DeployFormProps> = ({
  onDeploy,
  deploying,
  error,
}) => {
  const [selectedProject, setSelectedProject] = useLastSelectedProject();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { results: rbacResults, loading: rbacLoading } = useAccessReview(selectedProject);

  const canDeploy = useMemo(
    () => rbacResults.length > 0 && hasRequiredPermissions(rbacResults),
    [rbacResults],
  );

  const createResults = useMemo(
    () => rbacResults.filter((r) => r.verb === 'create'),
    [rbacResults],
  );

  const handleDeploy = () => {
    if (!selectedProject) return;
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    setConfirmOpen(false);
    if (selectedProject) {
      onDeploy(selectedProject);
    }
  };

  return (
    <>
      <Form data-testid="deploy-form">
        <FormSection title="Project">
          <FormGroup fieldId="project-selector" label="Select a project">
            <ProjectSelector
              selectedProject={selectedProject}
              onSelect={setSelectedProject}
              isDisabled={deploying}
            />
          </FormGroup>
        </FormSection>

        {selectedProject && (
          <FormSection title="Permissions">
            {rbacLoading ? (
              <Spinner size="md" aria-label="Checking permissions" />
            ) : (
              <List isPlain data-testid="rbac-results">
                {createResults.map((r) => (
                  <ListItem key={`${r.resource}-${r.verb}`}>
                    <Icon
                      status={r.allowed ? 'success' : 'danger'}
                      size="sm"
                    >
                      {r.allowed ? <CheckCircleIcon /> : <TimesCircleIcon />}
                    </Icon>{' '}
                    {r.resource}
                  </ListItem>
                ))}
              </List>
            )}
          </FormSection>
        )}

        {error && (
          <Alert variant="danger" title="Deploy failed" isInline>
            {error}
          </Alert>
        )}

        <ActionGroup>
          <Button
            variant="primary"
            onClick={handleDeploy}
            isDisabled={!selectedProject || !canDeploy || deploying || rbacLoading}
            isLoading={deploying}
          >
            Deploy Superset
          </Button>
        </ActionGroup>
      </Form>

      <Modal
        variant="small"
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        aria-label="Confirm deployment"
      >
        <ModalHeader title="Deploy Apache Superset" />
        <ModalBody>
          This will deploy Apache Superset and PostgreSQL into the project{' '}
          <strong>{selectedProject}</strong>. This creates Deployments, Services,
          ConfigMaps, Secrets, and a PersistentVolumeClaim.
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            onClick={handleConfirm}
          >
            Confirm
          </Button>
          <Button variant="link" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
};
