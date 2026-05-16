/**
 * ClickUp ↔ Tessera sync engine.
 *
 * Pull is the source of truth for everything except `workflow_status`, which
 * is bidirectional. Status push is fire-and-forget: a ClickUp outage must
 * never block local board moves. The `withPullOrigin` guard prevents the
 * pull loop's own `workflow_status` writes from echoing back to ClickUp.
 */

import logger from '@/lib/logger';
import * as dbTasks from '@/lib/db/tasks';
import {
  getProjectIntegration,
  setLastSynced,
  type ProjectIntegrationRow,
} from '@/lib/db/project-integrations';
import { SettingsManager } from '@/lib/settings/manager';
import type { UserSettings } from '@/lib/settings/types';
import { ClickUpAuthError, ClickUpClient } from './client';

type LoadSettingsFn = (userId: string, options?: { silent?: boolean }) => Promise<UserSettings>;
// Keep `this` bound when callers don't supply an override. Pulling the method
// off `SettingsManager.load` directly drops the class binding and breaks
// `this.ensureDir()` inside the static.
const defaultLoadSettings: LoadSettingsFn = (userId, options) =>
  SettingsManager.load(userId, options);
import { mapClickUpTaskToTessera, tesseraStatusToClickUp } from './mapping';

export interface ClickUpSyncEvent {
  type: 'sync_started' | 'sync_completed' | 'sync_failed' | 'task_upserted' | 'task_archived';
  userId: string;
  projectId: string;
  taskId?: string;
  message?: string;
  error?: string;
}

type Listener = (event: ClickUpSyncEvent) => void;

const GLOBAL_KEY = Symbol.for('tessera.clickupSync');
interface SyncState {
  listeners: Set<Listener>;
  inFlight: Map<string, Promise<PullResult>>;
  skipPush: Set<string>;
}

const g = globalThis as unknown as { [GLOBAL_KEY]?: SyncState };

function getState(): SyncState {
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      listeners: new Set(),
      inFlight: new Map(),
      skipPush: new Set(),
    };
  }
  return g[GLOBAL_KEY]!;
}

export function subscribeClickUpSyncEvents(listener: Listener): () => void {
  const state = getState();
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

function emit(event: ClickUpSyncEvent): void {
  for (const listener of getState().listeners) {
    try {
      listener(event);
    } catch (err) {
      logger.warn({ err, event }, 'ClickUp sync subscriber threw');
    }
  }
}

/**
 * Mark `taskId` as currently being mutated by the pull loop, so the PATCH
 * route's fire-and-forget push will skip it. The guard is per-task and
 * synchronous because the pull loop's `updateTask` call is synchronous.
 */
export function withPullOrigin(taskId: string, fn: () => void): void {
  const state = getState();
  state.skipPush.add(taskId);
  try {
    fn();
  } finally {
    state.skipPush.delete(taskId);
  }
}

export function shouldPushStatus(taskId: string): boolean {
  return !getState().skipPush.has(taskId);
}

export interface PullResult {
  inserted: number;
  updated: number;
  archived: number;
  failed: number;
}

interface PullDeps {
  loadIntegration?: (projectId: string) => ProjectIntegrationRow | undefined;
  loadSettings?: LoadSettingsFn;
  createClient?: (token: string) => ClickUpClient;
  /**
   * Override the post-pull WS fan-out. Defaults to lazy-loading
   * `broadcastTaskMutation`; tests pass a no-op to avoid pulling the WS graph.
   */
  notifyMutation?: (userId: string, projectId: string) => void;
}

export async function pullProjectClickUpTasks(
  opts: { projectId: string; userId: string },
  deps: PullDeps = {},
): Promise<PullResult> {
  const key = `${opts.userId}:${opts.projectId}`;
  const state = getState();
  const existing = state.inFlight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<PullResult> => {
    emit({ type: 'sync_started', userId: opts.userId, projectId: opts.projectId });
    try {
      const integration = (deps.loadIntegration ?? getProjectIntegration)(opts.projectId);
      if (!integration?.clickupListId || !integration.clickupStatusMap) {
        const msg = 'ClickUp integration is not configured for this project';
        emit({ type: 'sync_failed', userId: opts.userId, projectId: opts.projectId, error: msg });
        throw new Error(msg);
      }

      const settings = await (deps.loadSettings ?? defaultLoadSettings)(opts.userId, { silent: true });
      const token = settings.integrations?.clickup?.personalToken?.trim();
      if (!token) {
        const msg = 'ClickUp token is not configured for this user';
        emit({ type: 'sync_failed', userId: opts.userId, projectId: opts.projectId, error: msg });
        throw new Error(msg);
      }

      const client = (deps.createClient ?? ((t: string) => new ClickUpClient({ token: t })))(token);

      const remoteTasks = await client.listAllTasksForList(integration.clickupListId);
      const statusMap = integration.clickupStatusMap;

      let inserted = 0;
      let updated = 0;
      let failed = 0;
      const remoteIds: string[] = [];

      for (const remote of remoteTasks) {
        try {
          const mapped = mapClickUpTaskToTessera(remote, { statusMap });
          let resultTaskId = '';
          let wasCreated = false;
          withPullOrigin(remote.id, () => {
            const res = dbTasks.upsertExternalTask({
              projectId: opts.projectId,
              externalSource: 'clickup',
              externalId: mapped.externalId,
              title: mapped.title,
              workflowStatus: mapped.workflowStatus,
              externalStatus: mapped.externalStatus,
              externalUrl: mapped.externalUrl,
            });
            resultTaskId = res.taskId;
            wasCreated = res.created;
          });
          remoteIds.push(mapped.externalId);
          if (wasCreated) inserted += 1;
          else updated += 1;
          emit({
            type: 'task_upserted',
            userId: opts.userId,
            projectId: opts.projectId,
            taskId: resultTaskId,
          });
        } catch (err) {
          failed += 1;
          logger.warn({ err, remoteId: remote.id }, 'Failed to upsert ClickUp task');
        }
      }

      const archivedIds = dbTasks.archiveTasksMissingFromExternal(
        opts.projectId,
        'clickup',
        remoteIds,
      );
      for (const id of archivedIds) {
        emit({
          type: 'task_archived',
          userId: opts.userId,
          projectId: opts.projectId,
          taskId: id,
        });
      }

      setLastSynced(opts.projectId, new Date().toISOString());

      // Single fan-out so the user's board refetches once. Imported lazily so
      // tests can exercise the sync engine without spinning up the WS graph.
      try {
        if (deps.notifyMutation) {
          deps.notifyMutation(opts.userId, opts.projectId);
        } else {
          const { broadcastTaskMutation } = await import('@/lib/ws/mutation-broadcast');
          broadcastTaskMutation(opts.userId, {
            kind: 'updated',
            projectId: opts.projectId,
          });
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to broadcast task mutation after pull');
      }

      const result: PullResult = {
        inserted,
        updated,
        archived: archivedIds.length,
        failed,
      };

      emit({
        type: 'sync_completed',
        userId: opts.userId,
        projectId: opts.projectId,
        message: `Synced ${inserted + updated} task(s), archived ${archivedIds.length}`,
      });

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err, projectId: opts.projectId }, 'ClickUp pull failed');
      emit({
        type: 'sync_failed',
        userId: opts.userId,
        projectId: opts.projectId,
        error: msg,
      });
      throw err;
    } finally {
      state.inFlight.delete(key);
    }
  })();

  state.inFlight.set(key, promise);
  return promise;
}

interface PushDeps {
  loadIntegration?: (projectId: string) => ProjectIntegrationRow | undefined;
  loadSettings?: LoadSettingsFn;
  createClient?: (token: string) => ClickUpClient;
}

/**
 * Fire-and-forget by design. The caller (PATCH /api/tasks/[id]) must not
 * await this — local mutation has already succeeded and ClickUp outages must
 * not bubble back as 5xx.
 */
export async function pushTaskStatusToClickUp(
  opts: { taskId: string; userId: string },
  deps: PushDeps = {},
): Promise<void> {
  try {
    if (!shouldPushStatus(opts.taskId)) return;

    const link = dbTasks.getTaskExternalLink(opts.taskId);
    if (!link || link.source !== 'clickup') return;

    const integration = (deps.loadIntegration ?? getProjectIntegration)(link.projectId);
    if (!integration?.clickupSyncEnabled || !integration.clickupStatusMap) return;

    const settings = await (deps.loadSettings ?? defaultLoadSettings)(opts.userId, { silent: true });
    const token = settings.integrations?.clickup?.personalToken?.trim();
    if (!token) return;

    const status = tesseraStatusToClickUp(link.workflowStatus, integration.clickupStatusMap);
    if (!status) {
      logger.warn(
        { taskId: opts.taskId, workflowStatus: link.workflowStatus },
        'No ClickUp status mapping for workflow status; skipping push',
      );
      return;
    }

    const client = (deps.createClient ?? ((t: string) => new ClickUpClient({ token: t })))(token);
    await client.updateTaskStatus(link.externalId, status);

    logger.info(
      { taskId: opts.taskId, clickupTaskId: link.externalId, status },
      'Pushed task status to ClickUp',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, taskId: opts.taskId }, 'ClickUp status push failed');
    emit({
      type: 'sync_failed',
      userId: opts.userId,
      projectId: '',
      taskId: opts.taskId,
      error: msg,
    });
    // Auth errors are worth nudging the user about, but never throw — fire-and-forget.
    if (err instanceof ClickUpAuthError) {
      logger.warn(
        { taskId: opts.taskId },
        'ClickUp auth rejected; user should reconnect their token',
      );
    }
  }
}
