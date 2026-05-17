import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { before } from 'node:test';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-studio-clickup-sync-'));
process.env.AGENT_STUDIO_DATA_DIR = TMP;
process.env.AGENT_STUDIO_PRODUCTION_DB = '1';

let initialized = false;

async function ensureInitialized() {
  if (initialized) return;
  const { initDatabase } = await import('../src/lib/db/database');
  await initDatabase();
  initialized = true;
}

before(async () => {
  await ensureInitialized();
});

function fakeClient(remoteTasks: Array<{
  id: string;
  name: string;
  status: { status: string };
  url: string;
}>) {
  return {
    listAllTasksForList: async () => remoteTasks,
    updateTaskStatus: async () => {
      // no-op for tests; push tests assert via spy instead
    },
  } as unknown as import('../src/lib/integrations/clickup/client').ClickUpClient;
}

const STATUS_MAP = {
  todo: 'to do',
  in_progress: 'in progress',
  in_review: 'in review',
  done: 'done',
};

test('pull inserts new external tasks and archives missing ones, preserving local state', async () => {
  const { upsertProjectIntegration } = await import('../src/lib/db/project-integrations');
  const dbTasks = await import('../src/lib/db/tasks');
  const { pullProjectClickUpTasks } = await import('../src/lib/integrations/clickup/sync');

  const projectId = 'proj_sync_archive';

  upsertProjectIntegration({
    projectId,
    clickupWorkspaceId: 'w',
    clickupSpaceId: 's',
    clickupListId: 'l',
    syncEnabled: true,
    statusMap: STATUS_MAP,
  });

  // Pre-seed a task that will go missing from the next pull.
  dbTasks.upsertExternalTask({
    projectId,
    externalSource: 'clickup',
    externalId: 'gone-1',
    title: 'Will be archived',
    workflowStatus: 'todo',
    externalStatus: 'to do',
    externalUrl: 'https://example/gone-1',
  });

  const remote = [
    { id: 'keep-1', name: 'Kept task', status: { status: 'in progress' }, url: 'https://example/keep-1' },
    { id: 'new-1', name: 'New task', status: { status: 'to do' }, url: 'https://example/new-1' },
  ];

  const result = await pullProjectClickUpTasks(
    { projectId, userId: 'user-1' },
    {
      loadIntegration: () => ({
        projectId,
        clickupWorkspaceId: 'w',
        clickupSpaceId: 's',
        clickupListId: 'l',
        clickupSyncEnabled: true,
        clickupStatusMap: STATUS_MAP,
        clickupLastSynced: null,
        createdAt: '',
        updatedAt: '',
      }),
      loadSettings: async () =>
        ({
          integrations: { clickup: { personalToken: 'fake-token' } },
        }) as any,
      createClient: () => fakeClient(remote),
      notifyMutation: () => {
        /* skip WS fan-out in tests */
      },
    },
  );

  assert.equal(result.inserted, 2);
  assert.equal(result.archived, 1, 'gone-1 should have been archived');

  const linked = dbTasks.getLinkedExternalTasks(projectId, 'clickup');
  const archived = linked.find((t) => t.external_id === 'gone-1');
  assert.ok(archived);
  assert.equal(archived.archived, 1, 'archived flag set on missing external');

  const kept = linked.find((t) => t.external_id === 'keep-1');
  assert.ok(kept);
  assert.equal(kept.workflow_status, 'in_progress');
});

test('upsertExternalTask preserves local-only fields (worktree_branch, summary, sort_order) on update', async () => {
  await ensureInitialized();
  const dbTasks = await import('../src/lib/db/tasks');

  const projectId = 'proj_sync_preserve';
  const first = dbTasks.upsertExternalTask({
    projectId,
    externalSource: 'clickup',
    externalId: 'preserve-1',
    title: 'Initial',
    workflowStatus: 'todo',
    externalStatus: 'to do',
  });

  // Imitate the user binding a worktree and summary locally after the first pull.
  dbTasks.updateTask(first.taskId, {
    worktree_branch: 'feat/some-branch',
    summary: 'local notes',
    sort_order: 42,
  });

  // Second pull updates title + status; local fields must be intact.
  dbTasks.upsertExternalTask({
    projectId,
    externalSource: 'clickup',
    externalId: 'preserve-1',
    title: 'Renamed upstream',
    workflowStatus: 'in_progress',
    externalStatus: 'in progress',
  });

  const linked = dbTasks.getLinkedExternalTasks(projectId, 'clickup');
  const entity = linked.find((t) => t.external_id === 'preserve-1');
  assert.ok(entity);
  assert.equal(entity.workflow_status, 'in_progress');

  const task = dbTasks.getTask(entity.id);
  assert.ok(task);
  assert.equal(task.title, 'Renamed upstream');
  assert.equal(task.worktreeBranch, 'feat/some-branch');
  assert.equal(task.summary, 'local notes');
  assert.equal(task.sortOrder, 42);
});

test('withPullOrigin suppresses push for the wrapped task', async () => {
  const sync = await import('../src/lib/integrations/clickup/sync');
  let inside = false;
  let outside = false;
  sync.withPullOrigin('task_x', () => {
    inside = sync.shouldPushStatus('task_x');
  });
  outside = sync.shouldPushStatus('task_x');
  assert.equal(inside, false, 'should be suppressed while wrapping');
  assert.equal(outside, true, 'should release after the wrapper returns');
});
