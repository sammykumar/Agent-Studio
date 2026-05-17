/**
 * Bridges the ClickUp sync event bus to the WebSocket layer.
 *
 * ClickUp state is per-user (each user has their own token), so we route
 * messages through `sendToUser` rather than the global `broadcast` helper.
 */

import logger from '@/lib/logger';
import { wsServer } from '@/lib/ws/server';
import { subscribeClickUpSyncEvents } from './sync';

let unsubscribe: (() => void) | null = null;

// Per-task `task_upserted` / `task_archived` events are useful for tests and
// future progress UI but would generate a WS message per row during a pull
// (potentially hundreds). The board refetches off the single `task_mutated`
// event the sync layer fires at the end. Forward only the lifecycle signals.
const FORWARDED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'sync_started',
  'sync_completed',
  'sync_failed',
]);

export function installClickUpSyncBroadcast(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeClickUpSyncEvents((event) => {
    if (!FORWARDED_EVENT_TYPES.has(event.type)) return;
    try {
      wsServer.sendToUser(event.userId, {
        type: 'clickup_sync_event',
        eventType: event.type,
        projectId: event.projectId,
        ...(event.taskId !== undefined ? { taskId: event.taskId } : {}),
        ...(event.message !== undefined ? { message: event.message } : {}),
        ...(event.error !== undefined ? { error: event.error } : {}),
      });
    } catch (err) {
      logger.warn({ err, event }, 'Failed to broadcast ClickUp sync event');
    }
  });
}

export function uninstallClickUpSyncBroadcast(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}
