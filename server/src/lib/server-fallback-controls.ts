import { supabase } from './supabase.js';

export const SERVER_FALLBACK_CONTROL_ADMIN_EMAIL = 'kyle.hicks@nps.edu';

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

export async function getAuthorizedServerFallbackAdmin(authHeader: string | undefined): Promise<{
  userId: string;
  email: string;
  displayName: string;
} | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user?.id) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('display_name, email')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) return null;

  const emailCandidates = [
    normalizeEmail(user.email),
    normalizeEmail(profile?.email),
    normalizeEmail(typeof user.user_metadata?.email === 'string' ? user.user_metadata.email : ''),
  ];
  const authorizedEmail = emailCandidates.find((value) => value === SERVER_FALLBACK_CONTROL_ADMIN_EMAIL);
  if (!authorizedEmail) return null;

  return {
    userId: user.id,
    email: authorizedEmail,
    displayName: (profile?.display_name ?? '').trim(),
  };
}

export async function isServerFallbackPausedForUser(userId: string | null | undefined): Promise<boolean> {
  const normalizedUserId = userId?.trim();
  if (!normalizedUserId) return false;

  const { data, error } = await supabase
    .from('user_server_fallback_controls')
    .select('server_fallback_paused')
    .eq('user_id', normalizedUserId)
    .maybeSingle();

  if (error) return false;
  return data?.server_fallback_paused === true;
}

export async function getServerFallbackPauseMap(userIds: string[]): Promise<Map<string, boolean>> {
  const normalizedUserIds = [...new Set(userIds.map((value) => value.trim()).filter(Boolean))];
  if (normalizedUserIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('user_server_fallback_controls')
    .select('user_id, server_fallback_paused')
    .in('user_id', normalizedUserIds)
    .eq('server_fallback_paused', true);

  if (error || !data) return new Map();

  return new Map(
    data
      .filter((row): row is { user_id: string; server_fallback_paused: boolean } => typeof row.user_id === 'string')
      .map((row) => [row.user_id, row.server_fallback_paused === true]),
  );
}

export async function setServerFallbackPausedForUser(userId: string, paused: boolean, actorUserId: string): Promise<void> {
  if (paused) {
    const { error } = await supabase
      .from('user_server_fallback_controls')
      .upsert({
        user_id: userId,
        server_fallback_paused: true,
        updated_by: actorUserId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('user_server_fallback_controls')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}
