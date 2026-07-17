import { K8sResource, K8sList } from '../types';
import { k8sRequest, K8sApiError } from './k8sClient';

function apiPath(
  apiVersion: string,
  kind: string,
  namespace?: string,
  name?: string,
): string {
  const isCore = !apiVersion.includes('/');
  const base = isCore ? '/api' : '/apis';
  const parts = [base, apiVersion];

  if (namespace) {
    parts.push('namespaces', namespace);
  }

  parts.push(kindToResource(kind));

  if (name) {
    parts.push(name);
  }

  return parts.join('/');
}

const KIND_RESOURCE_MAP: Record<string, string> = {
  Deployment: 'deployments',
  Service: 'services',
  ConfigMap: 'configmaps',
  Secret: 'secrets',
  PersistentVolumeClaim: 'persistentvolumeclaims',
  ServiceAccount: 'serviceaccounts',
  Job: 'jobs',
  Route: 'routes',
  Pod: 'pods',
  Namespace: 'namespaces',
};

function kindToResource(kind: string): string {
  const mapped = KIND_RESOURCE_MAP[kind];
  if (mapped) {
    return mapped;
  }
  return kind.toLowerCase() + 's';
}

export async function applyResource(
  token: string,
  resource: K8sResource,
): Promise<K8sResource> {
  const { apiVersion, kind, metadata } = resource;
  const createPath = apiPath(apiVersion, kind, metadata.namespace);

  try {
    return await k8sRequest<K8sResource>(token, createPath, {
      method: 'POST',
      body: resource,
    });
  } catch (err) {
    if (err instanceof K8sApiError && err.statusCode === 409) {
      const resourcePath = apiPath(apiVersion, kind, metadata.namespace, metadata.name);
      const existing = await k8sRequest<K8sResource>(token, resourcePath);
      const updated = {
        ...resource,
        metadata: {
          ...resource.metadata,
          resourceVersion: existing.metadata.resourceVersion,
        },
      };
      return k8sRequest<K8sResource>(token, resourcePath, {
        method: 'PUT',
        body: updated,
      });
    }
    throw err;
  }
}

export function deleteResource(
  token: string,
  apiVersion: string,
  kind: string,
  namespace: string,
  name: string,
): Promise<unknown> {
  const path = apiPath(apiVersion, kind, namespace, name);
  return k8sRequest(token, path, { method: 'DELETE' });
}

export function getResource<T = K8sResource>(
  token: string,
  apiVersion: string,
  kind: string,
  namespace: string,
  name: string,
): Promise<T> {
  const path = apiPath(apiVersion, kind, namespace, name);
  return k8sRequest<T>(token, path);
}

export function listResources<T = K8sResource>(
  token: string,
  apiVersion: string,
  kind: string,
  namespace: string,
  labelSelector?: string,
): Promise<K8sList<T>> {
  let path = apiPath(apiVersion, kind, namespace);
  if (labelSelector) {
    path += `?labelSelector=${encodeURIComponent(labelSelector)}`;
  }
  return k8sRequest<K8sList<T>>(token, path);
}
