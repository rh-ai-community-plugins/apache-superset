import React from 'react';
import {
  PageSection,
  Content,
  ContentVariants,
} from '@patternfly/react-core';

const EmbeddedDashboardsPage: React.FC = () => (
  <PageSection>
    <Content component={ContentVariants.h1}>Dashboards</Content>
    <Content component="p">
      Browse and embed Apache Superset dashboards.
    </Content>
  </PageSection>
);

export default EmbeddedDashboardsPage;
