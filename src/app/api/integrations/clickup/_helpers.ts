import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUserId } from '@/lib/auth/api-auth';
import { SettingsManager } from '@/lib/settings/manager';
import { ClickUpAuthError, ClickUpClient } from '@/lib/integrations/clickup/client';

/**
 * Resolve an authenticated user + a ClickUpClient using their stored PAT.
 * Returns a NextResponse on failure so route handlers can early-return.
 */
export async function getAuthedClickUpClient(
  req: NextRequest,
): Promise<{ userId: string; client: ClickUpClient } | { response: NextResponse }> {
  const auth = await requireAuthenticatedUserId(req);
  if ('response' in auth) return { response: auth.response };

  const settings = await SettingsManager.load(auth.userId, { silent: true });
  const token = settings.integrations?.clickup?.accessToken?.trim();
  if (!token) {
    return {
      response: NextResponse.json(
        { error: 'ClickUp is not connected', code: 'clickup_not_connected' },
        { status: 400 },
      ),
    };
  }
  return { userId: auth.userId, client: new ClickUpClient({ token }) };
}

export function clickUpErrorResponse(err: unknown, action: string): NextResponse {
  if (err instanceof ClickUpAuthError) {
    return NextResponse.json(
      { error: 'ClickUp token rejected — reconnect required', code: 'clickup_auth_failed' },
      { status: 401 },
    );
  }
  return NextResponse.json({ error: `Failed to ${action}` }, { status: 502 });
}
