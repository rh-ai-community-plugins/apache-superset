// --- K8s types ---

export interface K8sMetadata {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  [key: string]: unknown;
}

export interface K8sResource {
  apiVersion: string;
  kind: string;
  metadata: K8sMetadata;
  spec?: Record<string, unknown>;
  data?: Record<string, string>;
  stringData?: Record<string, string>;
  status?: { phase?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface K8sList<T = K8sResource> {
  apiVersion: string;
  kind: string;
  items: T[];
}

// --- Superset deployment types ---

export interface SupersetDeployRequest {
  namespace: string;
  dashboardOrigin: string;
  adminPassword?: string;
  secretKey?: string;
  postgresPassword?: string;
}

export type DeploymentPhase = 'not-deployed' | 'deploying' | 'running' | 'error';

export interface SupersetStatus {
  phase: DeploymentPhase;
  healthy: boolean;
  version?: string;
  url?: string;
  message?: string;
  resources?: {
    superset: ResourceStatus;
    postgres: ResourceStatus;
  };
}

export interface ResourceStatus {
  ready: boolean;
  replicas?: number;
  readyReplicas?: number;
  message?: string;
}

// --- Superset API types ---

export interface SupersetDashboard {
  id: number;
  title: string;
  url: string;
  status: string;
  embeddedId?: string;
  thumbnailUrl?: string;
}

export interface GuestTokenResponse {
  guestToken: string;
}

export interface SupersetHealthResponse {
  healthy: boolean;
  version?: string;
}

export interface SupersetLoginResponse {
  access_token: string;
}

// --- User identity ---

export interface UserInfo {
  userName: string;
  firstName?: string;
  lastName?: string;
}

// --- Instance configuration ---

export interface SupersetConfig {
  namespace: string;
  url?: string;
  mode: 'lightweight';
  version: string;
  embeddingEnabled: boolean;
}

// --- Helm renderer types ---

export interface HelmRenderContext {
  releaseName: string;
  namespace: string;
  values: Record<string, unknown>;
}

export interface HelmChartMeta {
  name: string;
  version: string;
  appVersion: string;
}
