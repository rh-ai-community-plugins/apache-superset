import { UserInfo } from '../types';
import { k8sRequest } from './k8sClient';

interface OpenShiftUser {
  metadata: { name: string };
  fullName?: string;
}

export async function getUserInfo(token: string): Promise<UserInfo> {
  const user = await k8sRequest<OpenShiftUser>(
    token,
    '/apis/user.openshift.io/v1/users/~',
  );

  if (!user) {
    throw new Error('Empty response from OpenShift User API');
  }

  const userName = user.metadata?.name;
  if (!userName) {
    throw new Error('OpenShift User API response missing metadata.name');
  }
  const fullName = user.fullName || '';
  const parts = fullName.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ');

  return { userName, firstName, lastName };
}
