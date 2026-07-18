import React, { useCallback, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  Content,
  ContentVariants,
  EmptyState,
  EmptyStateBody,
  Gallery,
  PageSection,
  Skeleton,
  Split,
  SplitItem,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import {
  ArrowLeftIcon,
  CompressIcon,
  ExpandIcon,
  ExternalLinkAltIcon,
  SyncAltIcon,
} from '@patternfly/react-icons';
import { useNavigate, useParams } from 'react-router-dom';
import { ROUTES } from '~/app/routes';
import { ProjectSelector } from '~/app/components/ProjectSelector';
import { DashboardList } from '~/app/components/DashboardList';
import { SupersetDashboardEmbed } from '~/app/components/SupersetDashboardEmbed';
import { EmbedErrorBoundary } from '~/app/components/EmbedErrorBoundary';
import './EmbeddedDashboardsPage.css';
import { useSupersetStatus } from '~/app/hooks/useSupersetStatus';
import { useSupersetDashboards } from '~/app/hooks/useSupersetDashboards';
import { useSupersetGuestToken } from '~/app/hooks/useSupersetGuestToken';
import { useLastSelectedProject } from '~/app/hooks/useLastSelectedProject';
import { SupersetDashboard } from '~/app/types';

const EmbeddedDashboardsPage: React.FC = () => {
  const [selectedProject, setSelectedProject] = useLastSelectedProject();
  const { status, loading: statusLoading } = useSupersetStatus(selectedProject);
  const { '*': dashboardPath } = useParams();
  const navigate = useNavigate();

  const supersetRunning = status?.phase === 'running';

  const {
    dashboards,
    loading: dashboardsLoading,
    error: dashboardsError,
    refresh: refreshDashboards,
  } = useSupersetDashboards(supersetRunning ? selectedProject : null);

  const embeddedId = dashboardPath || null;
  const supersetDomain = status?.url ?? '';

  const fetchGuestToken = useSupersetGuestToken(selectedProject, embeddedId);

  const handleSelectDashboard = useCallback(
    (dashboard: SupersetDashboard) => {
      if (dashboard.embeddedId) {
        navigate(dashboard.embeddedId);
      }
    },
    [navigate],
  );

  const handleBack = useCallback(() => {
    navigate(ROUTES.DASHBOARDS);
  }, [navigate]);

  if (embeddedId) {
    if (statusLoading) {
      return (
        <PageSection hasBodyWrapper={false}>
          <Skeleton screenreaderText="Loading Superset connection" height="400px" />
        </PageSection>
      );
    }
    if (!supersetRunning || !supersetDomain) {
      return (
        <PageSection hasBodyWrapper={false}>
          <NotRunningState />
        </PageSection>
      );
    }
    return (
      <EmbedView
        embeddedId={embeddedId}
        supersetDomain={supersetDomain}
        supersetUrl={status?.url}
        fetchGuestToken={fetchGuestToken}
        onBack={handleBack}
      />
    );
  }

  return (
    <ListView
      selectedProject={selectedProject}
      onProjectSelect={setSelectedProject}
      statusLoading={statusLoading}
      supersetRunning={supersetRunning}
      dashboards={dashboards}
      dashboardsLoading={dashboardsLoading}
      dashboardsError={dashboardsError}
      supersetUrl={status?.url}
      onSelectDashboard={handleSelectDashboard}
      onRefresh={refreshDashboards}
    />
  );
};

interface EmbedViewProps {
  embeddedId: string;
  supersetDomain: string;
  supersetUrl?: string;
  fetchGuestToken: () => Promise<string>;
  onBack: () => void;
}

const EmbedView: React.FC<EmbedViewProps> = ({
  embeddedId,
  supersetDomain,
  supersetUrl,
  fetchGuestToken,
  onBack,
}) => {
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <>
      <PageSection hasBodyWrapper={false}>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <Button
                variant="plain"
                onClick={onBack}
                aria-label="Back to dashboard list"
              >
                <ArrowLeftIcon />
              </Button>
            </ToolbarItem>
            <ToolbarItem>
              <Content component={ContentVariants.h1}>Dashboard</Content>
            </ToolbarItem>
            <ToolbarItem align={{ default: 'alignEnd' }}>
              <Split hasGutter>
                <SplitItem>
                  <Button
                    variant="plain"
                    onClick={() => setFullscreen((f) => !f)}
                    aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                  >
                    {fullscreen ? <CompressIcon /> : <ExpandIcon />}
                  </Button>
                </SplitItem>
                {supersetUrl && (
                  <SplitItem>
                    <Button
                      variant="link"
                      component="a"
                      href={supersetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      icon={<ExternalLinkAltIcon />}
                      iconPosition="end"
                    >
                      Open in Superset
                    </Button>
                  </SplitItem>
                )}
              </Split>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </PageSection>

      <PageSection
        hasBodyWrapper={false}
        isFilled
        className={fullscreen ? 'superset-fullscreen-overlay' : undefined}
      >
        {fullscreen && (
          <div className="pf-v6-u-mb-sm">
            <Button
              variant="plain"
              onClick={() => setFullscreen(false)}
              aria-label="Exit fullscreen"
            >
              <CompressIcon /> Exit fullscreen
            </Button>
          </div>
        )}
        <EmbedErrorBoundary key={embeddedId}>
          <SupersetDashboardEmbed
            dashboardId={embeddedId}
            supersetDomain={supersetDomain}
            fetchGuestToken={fetchGuestToken}
          />
        </EmbedErrorBoundary>
      </PageSection>
    </>
  );
};

interface ListViewProps {
  selectedProject: string | null;
  onProjectSelect: (project: string | null) => void;
  statusLoading: boolean;
  supersetRunning: boolean;
  dashboards: SupersetDashboard[];
  dashboardsLoading: boolean;
  dashboardsError: string | null;
  supersetUrl?: string;
  onSelectDashboard: (dashboard: SupersetDashboard) => void;
  onRefresh: () => void;
}

const ListView: React.FC<ListViewProps> = ({
  selectedProject,
  onProjectSelect,
  statusLoading,
  supersetRunning,
  dashboards,
  dashboardsLoading,
  dashboardsError,
  supersetUrl,
  onSelectDashboard,
  onRefresh,
}) => (
  <>
    <PageSection hasBodyWrapper={false}>
      <Content component={ContentVariants.h1}>Dashboards</Content>
      <Content component="p">
        Browse and embed Apache Superset dashboards.
      </Content>
    </PageSection>

    <PageSection hasBodyWrapper={false}>
      <Split hasGutter>
        <SplitItem>
          <ProjectSelector
            selectedProject={selectedProject}
            onSelect={onProjectSelect}
          />
        </SplitItem>
        {supersetRunning && (
          <SplitItem>
            <Button
              variant="plain"
              onClick={onRefresh}
              aria-label="Refresh dashboards"
            >
              <SyncAltIcon />
            </Button>
          </SplitItem>
        )}
      </Split>
    </PageSection>

    <PageSection hasBodyWrapper={false}>
      {!selectedProject ? (
        <EmptyState headingLevel="h3" titleText="Select a project">
          <EmptyStateBody>
            Select a project to view available dashboards.
          </EmptyStateBody>
        </EmptyState>
      ) : statusLoading ? (
        <Skeleton screenreaderText="Checking Superset status" height="100px" />
      ) : !supersetRunning ? (
        <NotRunningState />
      ) : dashboardsLoading ? (
        <Gallery hasGutter minWidths={{ default: '250px' }} aria-label="Loading dashboards">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardBody>
                <Skeleton fontSize="lg" width="70%" />
                <br />
                <Skeleton width="40%" />
              </CardBody>
            </Card>
          ))}
        </Gallery>
      ) : dashboardsError ? (
        <Alert variant="danger" title="Failed to load dashboards" isInline>
          {dashboardsError}
        </Alert>
      ) : (
        <DashboardList
          dashboards={dashboards}
          supersetUrl={supersetUrl}
          onSelect={onSelectDashboard}
        />
      )}
    </PageSection>
  </>
);

const NotRunningState: React.FC = () => {
  const navigate = useNavigate();
  return (
    <EmptyState headingLevel="h3" titleText="Superset is not running">
      <EmptyStateBody>
        Deploy a Superset instance before browsing dashboards.
      </EmptyStateBody>
      <Button variant="primary" onClick={() => navigate(ROUTES.INSTANCE)}>
        Go to Instance Management
      </Button>
    </EmptyState>
  );
};

export default EmbeddedDashboardsPage;
