import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { before } from 'node:test';

// Database singleton lives under a global symbol — set TESSERA_DATA_DIR before
// any import that may trigger DB initialization.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-clickup-db-'));
process.env.TESSERA_DATA_DIR = TMP;
process.env.TESSERA_PRODUCTION_DB = '1';

before(async () => {
  const { initDatabase } = await import('../src/lib/db/database');
  await initDatabase();
});

test('upsertProjectIntegration is idempotent and round-trips the status map', async () => {
  const {
    getProjectIntegration,
    upsertProjectIntegration,
    setLastSynced,
  } = await import('../src/lib/db/project-integrations');

  const projectId = 'proj_test_upsert';
  const statusMap = {
    todo: 'to do',
    in_progress: 'in progress',
    in_review: 'in review',
    done: 'done',
  };

  upsertProjectIntegration({
    projectId,
    clickupWorkspaceId: 'team-1',
    clickupSpaceId: 'space-1',
    clickupListId: 'list-1',
    syncEnabled: true,
    statusMap,
  });
  upsertProjectIntegration({
    projectId,
    syncEnabled: false,
  });

  const row = getProjectIntegration(projectId);
  assert.ok(row);
  assert.equal(row.clickupListId, 'list-1', 'list id is preserved on partial update');
  assert.equal(row.clickupSyncEnabled, false);
  assert.deepEqual(row.clickupStatusMap, statusMap);

  setLastSynced(projectId, '2026-05-16T00:00:00.000Z');
  assert.equal(getProjectIntegration(projectId)?.clickupLastSynced, '2026-05-16T00:00:00.000Z');
});

test('clearClickUpForAllProjects nulls the workspace/list fields and the flag', async () => {
  const {
    getProjectIntegration,
    upsertProjectIntegration,
    clearClickUpForAllProjects,
  } = await import('../src/lib/db/project-integrations');

  const projectId = 'proj_test_clear';
  upsertProjectIntegration({
    projectId,
    clickupWorkspaceId: 'w',
    clickupSpaceId: 's',
    clickupListId: 'l',
    syncEnabled: true,
    statusMap: { todo: 't', in_progress: 'p', in_review: 'r', done: 'd' },
  });

  clearClickUpForAllProjects();

  const row = getProjectIntegration(projectId);
  assert.ok(row);
  assert.equal(row.clickupWorkspaceId, null);
  assert.equal(row.clickupSpaceId, null);
  assert.equal(row.clickupListId, null);
  assert.equal(row.clickupSyncEnabled, false);
  assert.equal(row.clickupStatusMap, null);
});
