import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { supabase } from './supabase.js';

const INTERNAL_HEADER = 'x-odyssey-internal';
const INTERNAL_USER_HEADER = 'x-odyssey-user-id';

function getInternalRequestToken(): string {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? '';
  return createHash('sha256').update(`odyssey-internal:${serviceKey}`).digest('hex');
}

export function isInternalRequest(headers: IncomingHttpHeaders): boolean {
  const candidate = headers[INTERNAL_HEADER];
  const received = Array.isArray(candidate) ? candidate[0] : candidate;
  if (!received) return false;

  const expected = getInternalRequestToken();
  if (received.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export function getInternalRequestHeaders(userId?: string | null): Record<string, string> {
  return {
    [INTERNAL_HEADER]: getInternalRequestToken(),
    ...(userId ? { [INTERNAL_USER_HEADER]: userId } : {}),
  };
}

export function getInternalUserId(headers: IncomingHttpHeaders): string | null {
  const candidate = headers[INTERNAL_USER_HEADER];
  const value = Array.isArray(candidate) ? candidate[0] : candidate;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function getUserFromAuthHeader(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user.id;
}

export async function userHasProjectAccess(projectId: string, userId: string): Promise<boolean> {
  return (await getProjectAccess(projectId, userId)).allowed;
}

export async function getProjectAccess(projectId: string, userId: string): Promise<{ allowed: boolean; isOwner: boolean }> {
  const [{ data: project }, { data: membership }] = await Promise.all([
    supabase.from('projects').select('owner_id').eq('id', projectId).maybeSingle(),
    supabase.from('project_members').select('user_id').eq('project_id', projectId).eq('user_id', userId).maybeSingle(),
  ]);

  const isOwner = project?.owner_id === userId;
  return { allowed: isOwner || !!membership, isOwner };
}

export async function requireProjectAccessFromAuthHeader(
  projectId: string | undefined,
  authHeader: string | undefined,
): Promise<{ ok: true; userId: string; isOwner: boolean } | { ok: false; status: number; error: string }> {
  if (!projectId?.trim()) {
    return { ok: false, status: 400, error: 'projectId is required' };
  }

  const userId = await getUserFromAuthHeader(authHeader);
  if (!userId) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const access = await getProjectAccess(projectId, userId);
  if (!access.allowed) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, userId, isOwner: access.isOwner };
}
