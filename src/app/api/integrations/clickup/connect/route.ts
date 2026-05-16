import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUserId } from '@/lib/auth/api-auth';
import { SettingsManager } from '@/lib/settings/manager';
import { ClickUpAuthError, ClickUpClient } from '@/lib/integrations/clickup/client';
import logger from '@/lib/logger';

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUserId(req);
  if ('response' in auth) return auth.response;

  let body: { token?: unknown };
  try {
    body = (await req.json()) as { token?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  try {
    const client = new ClickUpClient({ token });
    const me = await client.getAuthorizedUser();
    const username = me.user.username;

    const previous = await SettingsManager.load(auth.userId, { silent: true });
    await SettingsManager.save(auth.userId, {
      ...previous,
      integrations: {
        ...previous.integrations,
        clickup: {
          ...previous.integrations.clickup,
          personalToken: token,
          username,
        },
      },
      lastModified: new Date().toISOString(),
    });

    return NextResponse.json({ connected: true, username });
  } catch (err) {
    if (err instanceof ClickUpAuthError) {
      return NextResponse.json(
        { error: 'ClickUp rejected the token', code: 'clickup_auth_failed' },
        { status: 400 },
      );
    }
    logger.error({ err }, 'Failed to connect ClickUp');
    return NextResponse.json({ error: 'Failed to connect to ClickUp' }, { status: 500 });
  }
}
