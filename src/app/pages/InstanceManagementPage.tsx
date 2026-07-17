import React from 'react';
import {
  PageSection,
  Content,
  ContentVariants,
} from '@patternfly/react-core';

const InstanceManagementPage: React.FC = () => (
  <PageSection>
    <Content component={ContentVariants.h1}>Instance Management</Content>
    <Content component="p">
      Deploy, monitor, and manage your Apache Superset instance.
    </Content>
  </PageSection>
);

export default InstanceManagementPage;
