import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUserId } from '@/lib/auth/api-auth';
import { getProject } from '@/lib/db/projects';
import { ClickUpAuthError } from '@/lib/integrations/clickup/client';
import { pullProjectClickUpTasks } from '@/lib/integrations/clickup/sync';
import logger from '@/lib/logger';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const auth = await requireAuthenticatedUserId(req);
  if ('response' in auth) return auth.response;

  const { projectId } = await params;
  if (!getProject(projectId)) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  try {
    const result = await pullProjectClickUpTasks({
      projectId,
      userId: auth.userId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ClickUpAuthError) {
      return NextResponse.json(
        { error: 'ClickUp token rejected — reconnect required', code: 'clickup_auth_failed' },
        { status: 401 },
      );
    }
    const message = err instanceof Error ? err.message : 'Sync failed';
    logger.warn({ err, projectId }, 'ClickUp sync failed');
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
