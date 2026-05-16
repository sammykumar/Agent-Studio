/**
 * Per-project integration configuration (ClickUp for v1).
 *
 * Status maps are stored JSON-encoded in `clickup_status_map`.
 */

import { getDb } from './database';
import logger from '../logger';

export interface ClickUpStatusMap {
  todo: string;
  in_progress: string;
  in_review: string;
  done: string;
}

export interface ProjectIntegrationRow {
  projectId: string;
  clickupWorkspaceId: string | null;
  clickupSpaceId: string | null;
  clickupListId: string | null;
  clickupSyncEnabled: boolean;
  clickupStatusMap: ClickUpStatusMap | null;
  clickupLastSynced: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawRow {
  project_id: string;
  clickup_workspace_id: string | null;
  clickup_space_id: string | null;
  clickup_list_id: string | null;
  clickup_sync_enabled: number;
  clickup_status_map: string | null;
  clickup_last_synced: string | null;
  created_at: string;
  updated_at: string;
}

function parseStatusMap(raw: string | null): ClickUpStatusMap | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.todo === 'string' &&
      typeof parsed.in_progress === 'string' &&
      typeof parsed.in_review === 'string' &&
      typeof parsed.done === 'string'
    ) {
      return parsed as ClickUpStatusMap;
    }
  } catch (err) {
    logger.warn({ err, raw }, 'Failed to parse clickup_status_map JSON');
  }
  return null;
}

function mapRow(row: RawRow | undefined): ProjectIntegrationRow | undefined {
  if (!row) return undefined;
  return {
    projectId: row.project_id,
    clickupWorkspaceId: row.clickup_workspace_id,
    clickupSpaceId: row.clickup_space_id,
    clickupListId: row.clickup_list_id,
    clickupSyncEnabled: !!row.clickup_sync_enabled,
    clickupStatusMap: parseStatusMap(row.clickup_status_map),
    clickupLastSynced: row.clickup_last_synced,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getProjectIntegration(projectId: string): ProjectIntegrationRow | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM project_integrations WHERE project_id = ?').get(projectId) as RawRow | undefined;
  return mapRow(row);
}

export interface UpsertProjectIntegrationInput {
  projectId: string;
  clickupWorkspaceId?: string | null;
  clickupSpaceId?: string | null;
  clickupListId?: string | null;
  syncEnabled?: boolean;
  statusMap?: ClickUpStatusMap | null;
}

export function upsertProjectIntegration(input: UpsertProjectIntegrationInput): ProjectIntegrationRow {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getProjectIntegration(input.projectId);

  const next = {
    projectId: input.projectId,
    clickupWorkspaceId:
      input.clickupWorkspaceId !== undefined ? input.clickupWorkspaceId : existing?.clickupWorkspaceId ?? null,
    clickupSpaceId:
      input.clickupSpaceId !== undefined ? input.clickupSpaceId : existing?.clickupSpaceId ?? null,
    clickupListId:
      input.clickupListId !== undefined ? input.clickupListId : existing?.clickupListId ?? null,
    clickupSyncEnabled:
      input.syncEnabled !== undefined ? input.syncEnabled : existing?.clickupSyncEnabled ?? false,
    clickupStatusMap:
      input.statusMap !== undefined ? input.statusMap : existing?.clickupStatusMap ?? null,
  };

  db.prepare(`
    INSERT INTO project_integrations (
      project_id, clickup_workspace_id, clickup_space_id, clickup_list_id,
      clickup_sync_enabled, clickup_status_map, clickup_last_synced,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      clickup_workspace_id = excluded.clickup_workspace_id,
      clickup_space_id     = excluded.clickup_space_id,
      clickup_list_id      = excluded.clickup_list_id,
      clickup_sync_enabled = excluded.clickup_sync_enabled,
      clickup_status_map   = excluded.clickup_status_map,
      updated_at           = excluded.updated_at
  `).run(
    next.projectId,
    next.clickupWorkspaceId,
    next.clickupSpaceId,
    next.clickupListId,
    next.clickupSyncEnabled ? 1 : 0,
    next.clickupStatusMap ? JSON.stringify(next.clickupStatusMap) : null,
    existing?.clickupLastSynced ?? null,
    existing?.createdAt ?? now,
    now,
  );

  return getProjectIntegration(input.projectId)!;
}

export function setLastSynced(projectId: string, iso: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE project_integrations
    SET clickup_last_synced = ?, updated_at = ?
    WHERE project_id = ?
  `).run(iso, now, projectId);
}

/**
 * Disable ClickUp sync on every row by clearing list/space/workspace + the flag.
 * `project_integrations` rows are not per-user, so this affects every user that
 * shares the DB. Callers (disconnect handler) accept this as documented.
 */
export function clearClickUpForAllProjects(): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE project_integrations
    SET clickup_workspace_id = NULL,
        clickup_space_id     = NULL,
        clickup_list_id      = NULL,
        clickup_sync_enabled = 0,
        clickup_status_map   = NULL,
        updated_at           = ?
  `).run(now);
}

export function listProjectIntegrations(): ProjectIntegrationRow[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM project_integrations').all() as RawRow[];
  return rows.map((r) => mapRow(r)!).filter(Boolean);
}
