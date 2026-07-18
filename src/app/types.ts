export type DeploymentPhase = 'not-deployed' | 'deploying' | 'running' | 'error';

export interface ResourceStatus {
  ready: boolean;
  replicas?: number;
  readyReplicas?: number;
  message?: string;
}

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

export interface SupersetDashboard {
  id: number;
  title: string;
  url: string;
  status: string;
  embeddedId?: string;
  thumbnailUrl?: string;
}

export interface DeployResult {
  message: string;
  namespace: string;
  applied: { kind: string; name: string }[];
  errors?: string[];
  warnings?: string[];
}

export interface TeardownResult {
  message: string;
  namespace: string;
  deleted: { kind: string; name: string }[];
  skipped?: { kind: string; name: string; reason: string }[];
  errors?: string[];
}
