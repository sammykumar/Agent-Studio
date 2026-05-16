import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUserId } from '@/lib/auth/api-auth';
import { SettingsManager } from '@/lib/settings/manager';
import { getProject } from '@/lib/db/projects';
import {
  getProjectIntegration,
  upsertProjectIntegration,
  type ClickUpStatusMap,
} from '@/lib/db/project-integrations';
import { ClickUpAuthError, ClickUpClient } from '@/lib/integrations/clickup/client';
import { defaultStatusMap } from '@/lib/integrations/clickup/mapping';
import logger from '@/lib/logger';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const auth = await requireAuthenticatedUserId(req);
  if ('response' in auth) return auth.response;

  const { projectId } = await params;
  if (!getProject(projectId)) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const integration = getProjectIntegration(projectId);
  if (!integration) {
    return NextResponse.json({ error: 'Integration not configured' }, { status: 404 });
  }
  return NextResponse.json({ integration });
}

interface PutBody {
  workspaceId?: string | null;
  spaceId?: string | null;
  listId?: string | null;
  syncEnabled?: boolean;
  statusMap?: Partial<ClickUpStatusMap> | null;
}

function isClickUpStatusMap(value: unknown): value is ClickUpStatusMap {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<ClickUpStatusMap>;
  return (
    typeof m.todo === 'string' &&
    typeof m.in_progress === 'string' &&
    typeof m.in_review === 'string' &&
    typeof m.done === 'string'
  );
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const auth = await requireAuthenticatedUserId(req);
  if ('response' in auth) return auth.response;

  const { projectId } = await params;
  if (!getProject(projectId)) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  let statusMap: ClickUpStatusMap | null | undefined;
  if (body.statusMap === null) {
    statusMap = null;
  } else if (body.statusMap !== undefined) {
    if (!isClickUpStatusMap(body.statusMap)) {
      return NextResponse.json(
        { error: 'statusMap must contain todo, in_progress, in_review, done strings' },
        { status: 400 },
      );
    }
    statusMap = body.statusMap;
  }

  // Auto-derive a default status map when none was supplied and we have a list.
  if (statusMap === undefined && body.listId) {
    try {
      const settings = await SettingsManager.load(auth.userId, { silent: true });
      const token = settings.integrations?.clickup?.personalToken?.trim();
      if (token) {
        const client = new ClickUpClient({ token });
        const { statuses } = await client.getListStatuses(body.listId);
        statusMap = defaultStatusMap(statuses);
      }
    } catch (err) {
      if (err instanceof ClickUpAuthError) {
        return NextResponse.json(
          { error: 'ClickUp token rejected — reconnect required', code: 'clickup_auth_failed' },
          { status: 401 },
        );
      }
      logger.warn({ err, listId: body.listId }, 'Failed to derive default status map');
    }
  }

  try {
    const integration = upsertProjectIntegration({
      projectId,
      clickupWorkspaceId: body.workspaceId ?? null,
      clickupSpaceId: body.spaceId ?? null,
      clickupListId: body.listId ?? null,
      syncEnabled: body.syncEnabled,
      statusMap,
    });
    return NextResponse.json({ integration });
  } catch (err) {
    logger.error({ err, projectId }, 'Failed to upsert ClickUp integration');
    return NextResponse.json({ error: 'Failed to save integration' }, { status: 500 });
  }
}
