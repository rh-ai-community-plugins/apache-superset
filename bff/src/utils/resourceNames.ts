const NAMESPACE_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function validateNamespace(ns: unknown): string | null {
  if (typeof ns !== 'string' || !ns.trim()) {
    return 'namespace is required';
  }
  if (!NAMESPACE_REGEX.test(ns)) {
    return 'namespace must be a valid Kubernetes namespace (lowercase alphanumeric and hyphens, max 63 chars)';
  }
  return null;
}

export const RELEASE_NAME = 'superset';
export const SUPERSET_PORT = 8088;
export const PART_OF_LABEL = 'app.kubernetes.io/part-of=superset';

export function getFullname(): string {
  return `${RELEASE_NAME}-superset`;
}

export function getDeploymentName(): string {
  return getFullname();
}

export function getPostgresDeploymentName(): string {
  return `${getFullname()}-postgres`;
}

export function getServiceName(): string {
  return `${getFullname()}-svc`;
}

export function getSecretName(): string {
  return `${getFullname()}-secret`;
}

export function getConfigMapName(): string {
  return `${getFullname()}-config`;
}

export function getRouteName(): string {
  return `${getFullname()}-route`;
}

export function getSupersetServiceUrl(namespace: string): string {
  return `http://${getServiceName()}.${namespace}.svc.cluster.local:${SUPERSET_PORT}`;
}
