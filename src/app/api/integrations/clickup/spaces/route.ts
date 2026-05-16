import { NextRequest, NextResponse } from 'next/server';
import { clickUpErrorResponse, getAuthedClickUpClient } from '../_helpers';
import logger from '@/lib/logger';

export async function GET(req: NextRequest) {
  const ctx = await getAuthedClickUpClient(req);
  if ('response' in ctx) return ctx.response;

  const teamId = req.nextUrl.searchParams.get('teamId');
  if (!teamId) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 });
  }

  try {
    const { spaces } = await ctx.client.listSpaces(teamId);
    return NextResponse.json({ spaces });
  } catch (err) {
    logger.warn({ err, teamId }, 'ClickUp listSpaces failed');
    return clickUpErrorResponse(err, 'list ClickUp spaces');
  }
}
