import React, { useEffect, useRef } from 'react';
import {
  Alert,
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
} from '@patternfly/react-core';

export interface LoadExamplesModalProps {
  isOpen: boolean;
  onClose: () => void;
  logs: string;
  isRunning: boolean;
  isDone: boolean;
  error: string | null;
  exitCode: number | null;
}

export const LoadExamplesModal: React.FC<LoadExamplesModalProps> = ({
  isOpen,
  onClose,
  logs,
  isRunning,
  isDone,
  error,
  exitCode,
}) => {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <Modal
      variant="medium"
      isOpen={isOpen}
      onClose={onClose}
      aria-label="Load examples log output"
    >
      <ModalHeader title="Loading example data" />
      <ModalBody>
        {isRunning && (
          <div className="pf-v6-u-mb-md">
            <Spinner size="md" /> Loading examples...
          </div>
        )}
        {isDone && exitCode === 0 && (
          <Alert variant="success" title="Examples loaded successfully" isInline className="pf-v6-u-mb-md" />
        )}
        {error && (
          <Alert variant="danger" title="Load examples failed" isInline className="pf-v6-u-mb-md">
            {error}
          </Alert>
        )}
        <div
          ref={logRef}
          role="log"
          style={{
            maxHeight: '400px',
            overflowY: 'auto',
            backgroundColor: 'var(--pf-t--global--background--color--secondary--default)',
            padding: 'var(--pf-t--global--spacer--sm)',
            borderRadius: 'var(--pf-t--global--border--radius--small)',
          }}
        >
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 'var(--pf-t--global--font--size--sm)' }}>
            {logs || (isRunning ? 'Waiting for output...' : '')}
          </pre>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="link" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
};
