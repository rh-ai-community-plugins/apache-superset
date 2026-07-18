import React from 'react';
import { Button, EmptyState, EmptyStateBody } from '@patternfly/react-core';
import { ExclamationCircleIcon } from '@patternfly/react-icons';

interface Props {
  children: React.ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class EmbedErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('EmbedErrorBoundary caught:', error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <EmptyState
          headingLevel="h3"
          titleText="Dashboard failed to render"
          icon={ExclamationCircleIcon}
        >
          <EmptyStateBody>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </EmptyStateBody>
          <Button variant="primary" onClick={this.handleReset}>
            Try again
          </Button>
        </EmptyState>
      );
    }

    return this.props.children;
  }
}
