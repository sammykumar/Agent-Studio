import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUserId } from '@/lib/auth/api-auth';
import { SettingsManager } from '@/lib/settings/manager';
import { clearClickUpForAllProjects } from '@/lib/db/project-integrations';
import logger from '@/lib/logger';

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUserId(req);
  if ('response' in auth) return auth.response;

  try {
    const previous = await SettingsManager.load(auth.userId, { silent: true });
    await SettingsManager.save(auth.userId, {
      ...previous,
      integrations: {
        ...previous.integrations,
        clickup: {
          accessToken: '',
        },
      },
      lastModified: new Date().toISOString(),
    });
    // Note: project_integrations is not per-user; clearing here affects every
    // user that shares the DB. Documented in the integration plan.
    clearClickUpForAllProjects();
    return NextResponse.json({ connected: false });
  } catch (err) {
    logger.error({ err }, 'Failed to disconnect ClickUp');
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
  }
}
