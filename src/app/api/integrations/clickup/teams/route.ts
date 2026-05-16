import { NextRequest, NextResponse } from 'next/server';
import { clickUpErrorResponse, getAuthedClickUpClient } from '../_helpers';
import logger from '@/lib/logger';

export async function GET(req: NextRequest) {
  const ctx = await getAuthedClickUpClient(req);
  if ('response' in ctx) return ctx.response;

  try {
    const { teams } = await ctx.client.listTeams();
    return NextResponse.json({ teams });
  } catch (err) {
    logger.warn({ err }, 'ClickUp listTeams failed');
    return clickUpErrorResponse(err, 'list ClickUp teams');
  }
}
