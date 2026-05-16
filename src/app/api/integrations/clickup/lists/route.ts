import { NextRequest, NextResponse } from 'next/server';
import { clickUpErrorResponse, getAuthedClickUpClient } from '../_helpers';
import logger from '@/lib/logger';

export async function GET(req: NextRequest) {
  const ctx = await getAuthedClickUpClient(req);
  if ('response' in ctx) return ctx.response;

  const spaceId = req.nextUrl.searchParams.get('spaceId');
  if (!spaceId) {
    return NextResponse.json({ error: 'spaceId is required' }, { status: 400 });
  }

  try {
    const { lists } = await ctx.client.listLists(spaceId);
    return NextResponse.json({ lists });
  } catch (err) {
    logger.warn({ err, spaceId }, 'ClickUp listLists failed');
    return clickUpErrorResponse(err, 'list ClickUp lists');
  }
}
