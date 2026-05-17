import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';

const AUTHORIZE_URL = 'https://app.clickup.com/api';
const TOKEN_URL = 'https://api.clickup.com/api/v2/oauth/token';
const CALLBACK_PATH = '/api/integrations/clickup/oauth/callback';

export class ClickUpOAuthConfigError extends Error {
  readonly kind = 'config' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ClickUpOAuthConfigError';
  }
}

export class ClickUpOAuthError extends Error {
  readonly kind = 'oauth' as const;
  constructor(message: string, readonly status: number, readonly bodyExcerpt?: string) {
    super(message);
    this.name = 'ClickUpOAuthError';
  }
}

export interface ClickUpOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUriOverride?: string;
}

export function getOAuthConfig(): ClickUpOAuthConfig {
  const clientId = process.env.CLICKUP_CLIENT_ID?.trim();
  const clientSecret = process.env.CLICKUP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new ClickUpOAuthConfigError(
      'CLICKUP_CLIENT_ID and CLICKUP_CLIENT_SECRET must be set',
    );
  }
  const redirectUriOverride = process.env.CLICKUP_OAUTH_REDIRECT_URI?.trim() || undefined;
  return { clientId, clientSecret, redirectUriOverride };
}

export function resolveRedirectUri(req: NextRequest, config: ClickUpOAuthConfig): string {
  if (config.redirectUriOverride) return config.redirectUriOverride;
  // Prefer x-forwarded headers so the URI matches what the browser saw (proxy / ngrok).
  const forwardedProto =
    req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || req.nextUrl.protocol.replace(':', '');
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.nextUrl.host;
  return `${forwardedProto}://${forwardedHost}${CALLBACK_PATH}`;
}

export function buildAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string }> {
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code: args.code,
  });
  const res = await (args.fetchImpl ?? fetch)(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ClickUpOAuthError(
      `ClickUp token exchange failed (${res.status})`,
      res.status,
      text.slice(0, 500),
    );
  }
  let parsed: { access_token?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ClickUpOAuthError('ClickUp token response was not JSON', res.status, text.slice(0, 500));
  }
  if (!parsed.access_token) {
    throw new ClickUpOAuthError('ClickUp token response missing access_token', res.status, text.slice(0, 500));
  }
  return { accessToken: parsed.access_token };
}

export function generateState(): string {
  return randomBytes(32).toString('hex');
}

export const CLICKUP_OAUTH_STATE_COOKIE = 'clickup_oauth_state';
