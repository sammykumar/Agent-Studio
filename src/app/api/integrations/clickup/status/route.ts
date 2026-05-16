import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUserId } from '@/lib/auth/api-auth';
import { SettingsManager } from '@/lib/settings/manager';
import logger from '@/lib/logger';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedUserId(req);
  if ('response' in auth) return auth.response;

  try {
    const settings = await SettingsManager.load(auth.userId, { silent: true });
    const clickup = settings.integrations?.clickup;
    return NextResponse.json({
      connected: Boolean(clickup?.personalToken),
      username: clickup?.username,
      workspaceId: clickup?.workspaceId,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to load ClickUp status');
    return NextResponse.json({ error: 'Failed to load status' }, { status: 500 });
  }
}
