import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUserId } from '@/lib/auth/api-auth';
import {
  CLICKUP_OAUTH_STATE_COOKIE,
  ClickUpOAuthConfigError,
  buildAuthorizeUrl,
  generateState,
  getOAuthConfig,
  resolveRedirectUri,
} from '@/lib/integrations/clickup/oauth';
import logger from '@/lib/logger';

const STATE_COOKIE_MAX_AGE_S = 15 * 60;

function safeReturnTo(raw: string | null): string {
  if (!raw) return '/';
  // Reject anything that isn't a same-origin relative path. `//foo` and `/\foo`
  // are protocol-relative tricks browsers normalize into another origin.
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedUserId(req);
  if ('response' in auth) return auth.response;

  let config;
  try {
    config = getOAuthConfig();
  } catch (err) {
    if (err instanceof ClickUpOAuthConfigError) {
      logger.error({ err }, 'ClickUp OAuth env vars missing');
      return NextResponse.json(
        { error: 'ClickUp OAuth is not configured on this server', code: 'clickup_oauth_misconfigured' },
        { status: 500 },
      );
    }
    throw err;
  }

  const returnTo = safeReturnTo(req.nextUrl.searchParams.get('returnTo'));
  const state = generateState();
  const redirectUri = resolveRedirectUri(req, config);
  const authorizeUrl = buildAuthorizeUrl({ clientId: config.clientId, redirectUri, state });

  const res = NextResponse.redirect(authorizeUrl, { status: 302 });
  res.cookies.set(CLICKUP_OAUTH_STATE_COOKIE, `${state}:${returnTo}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // sameSite must be 'lax' so the cookie is sent on ClickUp's top-level redirect back.
    sameSite: 'lax',
    maxAge: STATE_COOKIE_MAX_AGE_S,
    path: '/',
  });
  return res;
}
