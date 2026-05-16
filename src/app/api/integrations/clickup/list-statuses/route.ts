import { NextRequest, NextResponse } from 'next/server';
import { clickUpErrorResponse, getAuthedClickUpClient } from '../_helpers';
import logger from '@/lib/logger';

export async function GET(req: NextRequest) {
  const ctx = await getAuthedClickUpClient(req);
  if ('response' in ctx) return ctx.response;

  const listId = req.nextUrl.searchParams.get('listId');
  if (!listId) {
    return NextResponse.json({ error: 'listId is required' }, { status: 400 });
  }

  try {
    const { statuses } = await ctx.client.getListStatuses(listId);
    return NextResponse.json({ statuses });
  } catch (err) {
    logger.warn({ err, listId }, 'ClickUp getListStatuses failed');
    return clickUpErrorResponse(err, 'fetch ClickUp list statuses');
  }
}
