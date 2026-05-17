'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchWithClientId } from '@/lib/api/fetch-with-client-id';
import { useSessionStore } from '@/stores/session-store';
import { useTaskStore } from '@/stores/task-store';
import type { ClickUpStatusMap } from '@/lib/db/project-integrations';

interface ClickUpStatusEntry {
  status: string;
  type: string;
}

interface ListEntry {
  id: string;
  name: string;
  folder?: { id: string; name: string } | null;
}

interface ProjectIntegration {
  projectId: string;
  clickupWorkspaceId: string | null;
  clickupSpaceId: string | null;
  clickupListId: string | null;
  clickupSyncEnabled: boolean;
  clickupStatusMap: ClickUpStatusMap | null;
  clickupLastSynced: string | null;
}

export default function ClickUpSettings() {
  const currentProjectId = useTaskStore((s) => s.currentProjectId);
  const projects = useSessionStore((s) => s.projects);
  const projectOptions = useMemo(
    () =>
      projects.map((p) => ({
        // API routes key on `decodedPath` (e.g. /Users/.../agent-studio) — see
        // /api/projects/[projectId]/integrations/clickup.
        value: p.decodedPath,
        label: p.displayName,
      })),
    [projects],
  );

  // Default to whichever project the user has open on the board; fall back to
  // the first registered project so the panel works even when no board is open.
  const initialProjectId = currentProjectId ?? projectOptions[0]?.value ?? null;
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);

  // Sync project picker if the user opens a different board after mounting.
  useEffect(() => {
    if (currentProjectId && currentProjectId !== projectId) {
      setProjectId(currentProjectId);
    }
  }, [currentProjectId, projectId]);

  // Backfill the selection once the project list loads (panel can render
  // before useSessionStore finishes its first fetch).
  useEffect(() => {
    if (!projectId && projectOptions[0]) {
      setProjectId(projectOptions[0].value);
    }
  }, [projectId, projectOptions]);

  // Connection state
  const [connected, setConnected] = useState<boolean | null>(null);
  const [username, setUsername] = useState<string | undefined>();
  const [tokenInput, setTokenInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Pickers
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [spaces, setSpaces] = useState<Array<{ id: string; name: string }>>([]);
  const [lists, setLists] = useState<ListEntry[]>([]);
  const [statuses, setStatuses] = useState<ClickUpStatusEntry[]>([]);
  const [teamId, setTeamId] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [listId, setListId] = useState('');
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [statusMap, setStatusMap] = useState<ClickUpStatusMap | null>(null);

  const [projectIntegration, setProjectIntegration] = useState<ProjectIntegration | null>(null);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetchWithClientId('/api/integrations/clickup/status');
      if (!res.ok) throw new Error('Failed to load ClickUp status');
      const data = (await res.json()) as { connected: boolean; username?: string };
      setConnected(data.connected);
      setUsername(data.username);
      return data.connected;
    } catch (err) {
      console.error(err);
      setConnected(false);
      return false;
    }
  }, []);

  const loadTeams = useCallback(async () => {
    try {
      const res = await fetchWithClientId('/api/integrations/clickup/teams');
      if (!res.ok) return;
      const data = (await res.json()) as { teams: Array<{ id: string; name: string }> };
      setTeams(data.teams ?? []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const loadSpaces = useCallback(async (tid: string) => {
    if (!tid) {
      setSpaces([]);
      return;
    }
    try {
      const res = await fetchWithClientId(
        `/api/integrations/clickup/spaces?teamId=${encodeURIComponent(tid)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { spaces: Array<{ id: string; name: string }> };
      setSpaces(data.spaces ?? []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const loadLists = useCallback(async (sid: string) => {
    if (!sid) {
      setLists([]);
      return;
    }
    try {
      const res = await fetchWithClientId(
        `/api/integrations/clickup/lists?spaceId=${encodeURIComponent(sid)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { lists: ListEntry[] };
      setLists(data.lists ?? []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const loadStatuses = useCallback(async (lid: string) => {
    if (!lid) {
      setStatuses([]);
      return;
    }
    try {
      const res = await fetchWithClientId(
        `/api/integrations/clickup/list-statuses?listId=${encodeURIComponent(lid)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { statuses: ClickUpStatusEntry[] };
      setStatuses(data.statuses ?? []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const loadProjectIntegration = useCallback(async (pid: string) => {
    try {
      const res = await fetchWithClientId(
        `/api/projects/${encodeURIComponent(pid)}/integrations/clickup`,
      );
      if (res.status === 404) {
        setProjectIntegration(null);
        setTeamId('');
        setSpaceId('');
        setListId('');
        setSyncEnabled(false);
        setStatusMap(null);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { integration: ProjectIntegration };
      setProjectIntegration(data.integration);
      setTeamId(data.integration.clickupWorkspaceId ?? '');
      setSpaceId(data.integration.clickupSpaceId ?? '');
      setListId(data.integration.clickupListId ?? '');
      setSyncEnabled(data.integration.clickupSyncEnabled);
      setStatusMap(data.integration.clickupStatusMap);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const isConnected = await refreshStatus();
      if (isConnected) {
        await loadTeams();
        if (projectId) {
          await loadProjectIntegration(projectId);
        }
      }
    })();
  }, [refreshStatus, loadTeams, loadProjectIntegration, projectId]);

  useEffect(() => {
    if (connected && teamId) {
      void loadSpaces(teamId);
    }
  }, [connected, teamId, loadSpaces]);

  useEffect(() => {
    if (connected && spaceId) {
      void loadLists(spaceId);
    }
  }, [connected, spaceId, loadLists]);

  useEffect(() => {
    if (connected && listId) {
      void loadStatuses(listId);
    }
  }, [connected, listId, loadStatuses]);

  const handleConnect = useCallback(async () => {
    setBusy(true);
    setConnectError(null);
    try {
      const res = await fetchWithClientId('/api/integrations/clickup/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim() }),
      });
      const data = (await res.json()) as { error?: string; username?: string };
      if (!res.ok) {
        setConnectError(data.error ?? 'Failed to connect');
        return;
      }
      setConnected(true);
      setUsername(data.username);
      setTokenInput('');
      await loadTeams();
    } catch (err) {
      console.error(err);
      setConnectError('Failed to connect');
    } finally {
      setBusy(false);
    }
  }, [tokenInput, loadTeams]);

  const handleDisconnect = useCallback(async () => {
    setBusy(true);
    try {
      await fetchWithClientId('/api/integrations/clickup/disconnect', { method: 'POST' });
      setConnected(false);
      setUsername(undefined);
      setTeams([]);
      setSpaces([]);
      setLists([]);
      setStatuses([]);
      setProjectIntegration(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleSaveProject = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const res = await fetchWithClientId(
        `/api/projects/${encodeURIComponent(projectId)}/integrations/clickup`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId: teamId || null,
            spaceId: spaceId || null,
            listId: listId || null,
            syncEnabled,
            statusMap: statusMap ?? undefined,
          }),
        },
      );
      if (res.ok) {
        await loadProjectIntegration(projectId);
      }
    } finally {
      setBusy(false);
    }
  }, [projectId, teamId, spaceId, listId, syncEnabled, statusMap, loadProjectIntegration]);

  const handleSyncNow = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    setSyncSummary(null);
    setSyncError(null);
    try {
      const res = await fetchWithClientId(
        `/api/projects/${encodeURIComponent(projectId)}/integrations/clickup/sync`,
        { method: 'POST' },
      );
      const data = (await res.json()) as {
        error?: string;
        inserted?: number;
        updated?: number;
        archived?: number;
        failed?: number;
      };
      if (!res.ok) {
        setSyncError(data.error ?? 'Sync failed');
        return;
      }
      setSyncSummary(
        `Inserted ${data.inserted ?? 0}, updated ${data.updated ?? 0}, archived ${data.archived ?? 0}, failed ${data.failed ?? 0}`,
      );
      await loadProjectIntegration(projectId);
      // Refresh the board immediately. If the synced project is the one the
      // user is currently viewing, force-update `currentProjectId` + `tasks`
      // so newly-pulled cards appear without waiting on the WS broadcast
      // (which may be down due to a stale JWT, see "Cannot send to user, no
      // connections" warnings in the server log).
      if (projectId) {
        const taskStore = useTaskStore.getState();
        const setCurrent = taskStore.currentProjectId === projectId;
        void taskStore.loadTasks(projectId, { setCurrent });
      }
    } catch (err) {
      console.error(err);
      setSyncError('Sync failed');
    } finally {
      setBusy(false);
    }
  }, [projectId, loadProjectIntegration]);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h3 className="font-medium text-(--text-primary)">ClickUp</h3>
        <p className="text-xs text-(--text-tertiary)">
          Link a Agent Studio project to a ClickUp List. Status changes sync both ways;
          everything else flows ClickUp → Agent Studio.
        </p>
      </header>

      <section className="space-y-3 rounded-xl border border-(--divider) p-4">
        <h4 className="text-sm font-medium text-(--text-primary)">Connection</h4>
        {connected === null ? (
          <p className="text-xs text-(--text-tertiary)">Loading…</p>
        ) : connected ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-(--text-secondary)">
              Connected{username ? ` as ${username}` : ''}.
            </p>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="rounded-lg border border-(--divider) px-3 py-1.5 text-xs hover:bg-(--sidebar-hover)"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-xs text-(--text-secondary)">
              Personal API token
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="pk_..."
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-(--divider) bg-(--input-bg) px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-(--accent)"
              />
            </label>
            {connectError ? (
              <p className="text-xs text-red-500">{connectError}</p>
            ) : null}
            <button
              type="button"
              onClick={handleConnect}
              disabled={busy || !tokenInput.trim()}
              className="rounded-lg bg-(--accent) px-3 py-1.5 text-xs font-medium text-(--accent-foreground) disabled:opacity-60"
            >
              Connect
            </button>
            <p className="text-[11px] text-(--text-tertiary)">
              Generate a token in ClickUp → Settings → Apps → "API Token".
            </p>
          </div>
        )}
      </section>

      {connected && (
        <section className="space-y-3 rounded-xl border border-(--divider) p-4">
          <h4 className="text-sm font-medium text-(--text-primary)">
            Project link
          </h4>
          {projectOptions.length === 0 ? (
            <p className="text-xs text-(--text-tertiary)">
              No projects registered yet. Open or create one to configure its
              ClickUp link.
            </p>
          ) : (
            <div className="space-y-3">
              <SelectField
                label="Agent Studio project"
                value={projectId ?? ''}
                onChange={(v) => {
                  setProjectId(v || null);
                  // Reset cascading state — the new project may map to a
                  // different workspace/space/list.
                  setTeamId('');
                  setSpaceId('');
                  setListId('');
                  setSpaces([]);
                  setLists([]);
                  setStatuses([]);
                  setStatusMap(null);
                  setProjectIntegration(null);
                  setSyncSummary(null);
                  setSyncError(null);
                }}
                options={projectOptions}
              />
              <SelectField
                label="Workspace"
                value={teamId}
                onChange={(v) => {
                  setTeamId(v);
                  setSpaceId('');
                  setListId('');
                }}
                options={teams.map((t) => ({ value: t.id, label: t.name }))}
              />
              <SelectField
                label="Space"
                value={spaceId}
                onChange={(v) => {
                  setSpaceId(v);
                  setListId('');
                }}
                options={spaces.map((s) => ({ value: s.id, label: s.name }))}
                disabled={!teamId}
              />
              <SelectField
                label="List"
                value={listId}
                onChange={(v) => setListId(v)}
                options={lists.map((l) => ({
                  value: l.id,
                  label: l.folder ? `${l.folder.name} / ${l.name}` : l.name,
                }))}
                disabled={!spaceId}
              />

              <div className="flex items-center gap-2">
                <input
                  id="clickup-sync-enabled"
                  type="checkbox"
                  checked={syncEnabled}
                  onChange={(e) => setSyncEnabled(e.target.checked)}
                  className="h-4 w-4 accent-(--accent)"
                />
                <label
                  htmlFor="clickup-sync-enabled"
                  className="text-xs text-(--text-secondary)"
                >
                  Push Agent Studio status changes back to ClickUp
                </label>
              </div>

              {statusMap && (
                <div className="space-y-2 rounded-lg border border-(--divider) p-3">
                  <p className="text-xs font-medium text-(--text-primary)">Status mapping</p>
                  <StatusMapEditor
                    statusMap={statusMap}
                    statuses={statuses}
                    onChange={(next) => setStatusMap(next)}
                  />
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveProject}
                  disabled={busy || !listId}
                  className="rounded-lg border border-(--divider) px-3 py-1.5 text-xs hover:bg-(--sidebar-hover) disabled:opacity-60"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={handleSyncNow}
                  disabled={busy || !projectIntegration?.clickupListId}
                  className="rounded-lg bg-(--accent) px-3 py-1.5 text-xs font-medium text-(--accent-foreground) disabled:opacity-60"
                >
                  Sync now
                </button>
                {projectIntegration?.clickupLastSynced && (
                  <span className="text-[11px] text-(--text-tertiary)">
                    Last synced {new Date(projectIntegration.clickupLastSynced).toLocaleString()}
                  </span>
                )}
              </div>
              {syncSummary && (
                <p className="text-xs text-(--text-secondary)">{syncSummary}</p>
              )}
              {syncError && <p className="text-xs text-red-500">{syncError}</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="block text-xs text-(--text-secondary)">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-1 w-full rounded-lg border border-(--divider) bg-(--input-bg) px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-(--accent) disabled:opacity-50"
      >
        <option value="">Select…</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusMapEditor({
  statusMap,
  statuses,
  onChange,
}: {
  statusMap: ClickUpStatusMap;
  statuses: ClickUpStatusEntry[];
  onChange: (next: ClickUpStatusMap) => void;
}) {
  const rows: Array<{ key: keyof ClickUpStatusMap; label: string }> = [
    { key: 'todo', label: 'Todo' },
    { key: 'in_progress', label: 'Doing' },
    { key: 'in_review', label: 'Review' },
    { key: 'done', label: 'Done' },
  ];
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-2 text-xs">
          <span className="w-16 shrink-0 text-(--text-secondary)">{row.label}</span>
          <select
            value={statusMap[row.key]}
            onChange={(e) => onChange({ ...statusMap, [row.key]: e.target.value })}
            className="flex-1 rounded-lg border border-(--divider) bg-(--input-bg) px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-(--accent)"
          >
            {statuses.length === 0 && <option value={statusMap[row.key]}>{statusMap[row.key]}</option>}
            {statuses.map((s) => (
              <option key={s.status} value={s.status}>
                {s.status}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
