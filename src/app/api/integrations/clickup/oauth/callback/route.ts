import { NextRequest, NextResponse } from 'next/server';
import { SettingsManager } from '@/lib/settings/manager';
import { ClickUpAuthError, ClickUpClient } from '@/lib/integrations/clickup/client';
import {
  CLICKUP_OAUTH_STATE_COOKIE,
  ClickUpOAuthConfigError,
  ClickUpOAuthError,
  exchangeCodeForToken,
  getOAuthConfig,
} from '@/lib/integrations/clickup/oauth';
import logger from '@/lib/logger';

interface StateCookiePayload {
  state: string;
  userId: string;
  returnTo: string;
}

function parseStateCookie(raw: string | undefined): StateCookiePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StateCookiePayload>;
    if (typeof parsed.state !== 'string' || typeof parsed.userId !== 'string') return null;
    return {
      state: parsed.state,
      userId: parsed.userId,
      returnTo: typeof parsed.returnTo === 'string' && parsed.returnTo.startsWith('/') ? parsed.returnTo : '/',
    };
  } catch {
    return null;
  }
}

function redirectBack(req: NextRequest, returnTo: string, params: Record<string, string>) {
  const url = new URL(returnTo, req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = NextResponse.redirect(url, { status: 302 });
  res.cookies.delete(CLICKUP_OAUTH_STATE_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  // Note: we do NOT call requireAuthenticatedUserId here. The JWT cookie uses
  // sameSite=strict and gets stripped by the browser on ClickUp's cross-site
  // redirect back to us. The userId is instead carried in the OAuth state
  // cookie, which is sameSite=lax + httpOnly and was set by /oauth/start only
  // after that route did verify auth.
  const cookiePayload = parseStateCookie(req.cookies.get(CLICKUP_OAUTH_STATE_COOKIE)?.value);
  const returnTo = cookiePayload?.returnTo ?? '/';
  const expectedState = cookiePayload?.state;
  const userId = cookiePayload?.userId;

  // ClickUp surfaces user-cancelled consent here too — surface a generic error.
  const errorParam = req.nextUrl.searchParams.get('error');
  if (errorParam) {
    return redirectBack(req, returnTo, { clickup: 'error', reason: errorParam });
  }

  const state = req.nextUrl.searchParams.get('state');
  const code = req.nextUrl.searchParams.get('code');

  if (!expectedState || !userId || !state || state !== expectedState) {
    logger.warn(
      { hasCookie: Boolean(expectedState), hasUserId: Boolean(userId), hasState: Boolean(state) },
      'ClickUp OAuth state mismatch',
    );
    return redirectBack(req, returnTo, { clickup: 'error', reason: 'state_mismatch' });
  }
  if (!code) {
    return redirectBack(req, returnTo, { clickup: 'error', reason: 'missing_code' });
  }

  let config;
  try {
    config = getOAuthConfig();
  } catch (err) {
    if (err instanceof ClickUpOAuthConfigError) {
      logger.error({ err }, 'ClickUp OAuth env vars missing');
      return redirectBack(req, returnTo, { clickup: 'error', reason: 'misconfigured' });
    }
    throw err;
  }

  try {
    const { accessToken } = await exchangeCodeForToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
    });

    const client = new ClickUpClient({ token: accessToken });
    const me = await client.getAuthorizedUser();
    const username = me.user.username;

    const previous = await SettingsManager.load(userId, { silent: true });
    await SettingsManager.save(userId, {
      ...previous,
      integrations: {
        ...previous.integrations,
        clickup: {
          ...previous.integrations.clickup,
          accessToken,
          username,
        },
      },
      lastModified: new Date().toISOString(),
    });

    return redirectBack(req, returnTo, { clickup: 'connected' });
  } catch (err) {
    if (err instanceof ClickUpAuthError) {
      logger.warn({ err }, 'ClickUp rejected exchanged token');
      return redirectBack(req, returnTo, { clickup: 'error', reason: 'auth_failed' });
    }
    if (err instanceof ClickUpOAuthError) {
      logger.warn({ err }, 'ClickUp OAuth token exchange failed');
      return redirectBack(req, returnTo, { clickup: 'error', reason: 'exchange_failed' });
    }
    logger.error({ err }, 'ClickUp OAuth callback failed');
    return redirectBack(req, returnTo, { clickup: 'error', reason: 'unknown' });
  }
}
