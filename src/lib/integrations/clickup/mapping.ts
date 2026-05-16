/**
 * ClickUp ↔ Tessera workflow-status mapping.
 *
 * Bidirectional: pulling translates ClickUp status name → WorkflowStatus,
 * pushing the inverse. Mapping is generated from a list's status set on first
 * configuration and stored verbatim in `project_integrations.clickup_status_map`.
 */

import type { WorkflowStatus } from '@/types/task-entity';
import type { ClickUpStatus, ClickUpTask } from './client';
import type { ClickUpStatusMap } from '@/lib/db/project-integrations';

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Best-effort default mapping from a list's statuses to Tessera workflow
 * buckets. Heuristics:
 *   todo        ← exact 'to do'|'open'|'todo'|'backlog'  → else first type='open'
 *   in_review   ← contains 'review' or 'qa'              → else null
 *   done        ← exact 'done'|'closed'|'complete'       → else first type='closed'
 *   in_progress ← whatever 'custom' status is left, preferring 'in progress'|'doing'|'wip'
 *
 * If anything can't be resolved (e.g. list has only "Open" and "Closed"), the
 * caller's bucket gets the closest neighbour rather than the empty string —
 * callers should be allowed to override.
 */
export function defaultStatusMap(statuses: ClickUpStatus[]): ClickUpStatusMap {
  const ordered = [...statuses].sort((a, b) => (a.orderindex ?? 0) - (b.orderindex ?? 0));

  const byName = new Map<string, ClickUpStatus>();
  for (const s of ordered) byName.set(normalizeName(s.status), s);

  const findExact = (...names: string[]): ClickUpStatus | undefined => {
    for (const n of names) {
      const hit = byName.get(normalizeName(n));
      if (hit) return hit;
    }
    return undefined;
  };

  const findContaining = (needle: string): ClickUpStatus | undefined =>
    ordered.find((s) => normalizeName(s.status).includes(needle));

  const firstOfType = (type: string): ClickUpStatus | undefined =>
    ordered.find((s) => s.type === type);

  const todo =
    findExact('to do', 'todo', 'open', 'backlog') ??
    firstOfType('open') ??
    ordered[0];

  const done =
    findExact('done', 'closed', 'complete', 'completed') ??
    firstOfType('closed') ??
    ordered[ordered.length - 1];

  const review =
    findExact('in review', 'review', 'qa', 'code review') ??
    findContaining('review');

  // Anything that isn't todo / done / review and is type=custom is a candidate
  // for in_progress. Prefer the canonical names first.
  const inProgressCandidates = ordered.filter(
    (s) => s !== todo && s !== done && s !== review,
  );
  const inProgress =
    findExact('in progress', 'doing', 'wip', 'working on it', 'started') ??
    inProgressCandidates.find((s) => s.type === 'custom') ??
    inProgressCandidates[0] ??
    todo;

  return {
    todo: todo?.status ?? '',
    in_progress: inProgress?.status ?? todo?.status ?? '',
    in_review: review?.status ?? inProgress?.status ?? todo?.status ?? '',
    done: done?.status ?? '',
  };
}

/**
 * Translate a ClickUp task into the fields needed for upsert into Tessera.
 */
export function mapClickUpTaskToTessera(
  remote: ClickUpTask,
  ctx: { statusMap: ClickUpStatusMap },
): {
  externalId: string;
  title: string;
  workflowStatus: WorkflowStatus;
  externalStatus: string;
  externalUrl: string;
} {
  const status = remote.status?.status ?? '';
  return {
    externalId: remote.id,
    title: remote.name,
    workflowStatus: clickUpStatusToWorkflow(status, ctx.statusMap),
    externalStatus: status,
    externalUrl: remote.url,
  };
}

export function clickUpStatusToWorkflow(
  clickupStatus: string,
  map: ClickUpStatusMap,
): WorkflowStatus {
  const normalized = normalizeName(clickupStatus);
  if (normalized === normalizeName(map.done)) return 'done';
  if (normalized === normalizeName(map.in_review)) return 'in_review';
  if (normalized === normalizeName(map.in_progress)) return 'in_progress';
  if (normalized === normalizeName(map.todo)) return 'todo';
  // Unknown status — best-effort fallback based on heuristic.
  if (normalized.includes('done') || normalized.includes('closed') || normalized.includes('complete')) {
    return 'done';
  }
  if (normalized.includes('review') || normalized.includes('qa')) return 'in_review';
  if (
    normalized.includes('progress') ||
    normalized.includes('doing') ||
    normalized.includes('wip') ||
    normalized.includes('working') ||
    normalized.includes('started')
  ) {
    return 'in_progress';
  }
  return 'todo';
}

/**
 * Inverse: pick the ClickUp status name to PUT when the user moves a Tessera
 * task to a given workflow bucket. Returns empty string when the map is
 * missing that bucket — callers should treat that as "skip push".
 */
export function tesseraStatusToClickUp(
  workflowStatus: WorkflowStatus,
  map: ClickUpStatusMap,
): string {
  switch (workflowStatus) {
    case 'todo':
      return map.todo;
    case 'in_progress':
      return map.in_progress;
    case 'in_review':
      return map.in_review;
    case 'done':
      return map.done;
  }
}
