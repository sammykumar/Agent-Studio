import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultStatusMap,
  mapClickUpTaskToAgentStudio,
  agentStudioStatusToClickUp,
  clickUpStatusToWorkflow,
} from '../src/lib/integrations/clickup/mapping';
import type { ClickUpStatus, ClickUpTask } from '../src/lib/integrations/clickup/client';
import type { ClickUpStatusMap } from '../src/lib/db/project-integrations';

const STATUSES: ClickUpStatus[] = [
  { status: 'to do', type: 'open', orderindex: 0 },
  { status: 'in progress', type: 'custom', orderindex: 1 },
  { status: 'in review', type: 'custom', orderindex: 2 },
  { status: 'done', type: 'closed', orderindex: 3 },
];

test('defaultStatusMap resolves all four buckets for canonical names', () => {
  const map = defaultStatusMap(STATUSES);
  assert.equal(map.todo, 'to do');
  assert.equal(map.in_progress, 'in progress');
  assert.equal(map.in_review, 'in review');
  assert.equal(map.done, 'done');
});

test('defaultStatusMap is case-insensitive', () => {
  const map = defaultStatusMap([
    { status: 'TODO', type: 'open' },
    { status: 'In Progress', type: 'custom' },
    { status: 'Review', type: 'custom' },
    { status: 'COMPLETE', type: 'closed' },
  ]);
  assert.equal(map.todo, 'TODO');
  assert.equal(map.in_progress, 'In Progress');
  assert.equal(map.in_review, 'Review');
  assert.equal(map.done, 'COMPLETE');
});

test('defaultStatusMap falls back to status types when names are non-canonical', () => {
  const map = defaultStatusMap([
    { status: 'open', type: 'open' },
    { status: 'wip', type: 'custom' },
    { status: 'closed', type: 'closed' },
  ]);
  assert.equal(map.todo, 'open');
  assert.equal(map.in_progress, 'wip');
  assert.equal(map.done, 'closed');
});

test('mapClickUpTaskToAgentStudio produces every TaskRow input field', () => {
  const map = defaultStatusMap(STATUSES);
  const task: ClickUpTask = {
    id: 'abc',
    name: 'My task',
    status: { status: 'in progress' },
    url: 'https://app.clickup.com/t/abc',
  };
  const mapped = mapClickUpTaskToAgentStudio(task, { statusMap: map });
  assert.equal(mapped.externalId, 'abc');
  assert.equal(mapped.title, 'My task');
  assert.equal(mapped.workflowStatus, 'in_progress');
  assert.equal(mapped.externalStatus, 'in progress');
  assert.equal(mapped.externalUrl, 'https://app.clickup.com/t/abc');
});

test('clickUpStatusToWorkflow handles each canonical workflow status', () => {
  const map = defaultStatusMap(STATUSES);
  assert.equal(clickUpStatusToWorkflow('to do', map), 'todo');
  assert.equal(clickUpStatusToWorkflow('in progress', map), 'in_progress');
  assert.equal(clickUpStatusToWorkflow('in review', map), 'in_review');
  assert.equal(clickUpStatusToWorkflow('done', map), 'done');
});

test('clickUpStatusToWorkflow falls back via heuristic on unknown statuses', () => {
  const map: ClickUpStatusMap = { todo: '', in_progress: '', in_review: '', done: '' };
  assert.equal(clickUpStatusToWorkflow('Working on it', map), 'in_progress');
  assert.equal(clickUpStatusToWorkflow('Awaiting QA review', map), 'in_review');
  assert.equal(clickUpStatusToWorkflow('Closed', map), 'done');
  assert.equal(clickUpStatusToWorkflow('???', map), 'todo');
});

test('agentStudioStatusToClickUp inverts the status map for every workflow value', () => {
  const map = defaultStatusMap(STATUSES);
  assert.equal(agentStudioStatusToClickUp('todo', map), 'to do');
  assert.equal(agentStudioStatusToClickUp('in_progress', map), 'in progress');
  assert.equal(agentStudioStatusToClickUp('in_review', map), 'in review');
  assert.equal(agentStudioStatusToClickUp('done', map), 'done');
});

test('round-trip: clickUpStatusToWorkflow then agentStudioStatusToClickUp returns original mapping', () => {
  const map = defaultStatusMap(STATUSES);
  const cases = ['to do', 'in progress', 'in review', 'done'] as const;
  for (const status of cases) {
    const workflow = clickUpStatusToWorkflow(status, map);
    const back = agentStudioStatusToClickUp(workflow, map);
    assert.equal(back, status, `expected ${status} round trip`);
  }
});
