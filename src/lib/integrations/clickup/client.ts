/**
 * Minimal fetch wrapper around the ClickUp v2 REST API.
 *
 * Auth uses a Personal API Token sent in the `Authorization` header — no OAuth
 * for v1. Errors are surfaced as typed classes so the sync layer can decide
 * whether to disable the integration (auth) vs. retry (transient).
 *
 * https://clickup.com/api/
 */

const BASE_URL = 'https://api.clickup.com/api/v2';

export class ClickUpAuthError extends Error {
  readonly kind = 'auth' as const;
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ClickUpAuthError';
  }
}

export class ClickUpApiError extends Error {
  readonly kind = 'api' as const;
  constructor(message: string, readonly status: number, readonly bodyExcerpt?: string) {
    super(message);
    this.name = 'ClickUpApiError';
  }
}

export interface ClickUpTeam {
  id: string;
  name: string;
  color?: string;
  avatar?: string | null;
}

export interface ClickUpSpace {
  id: string;
  name: string;
  private?: boolean;
}

export interface ClickUpFolder {
  id: string;
  name: string;
  lists?: ClickUpList[];
}

export interface ClickUpList {
  id: string;
  name: string;
  folder?: { id: string; name: string } | null;
  space?: { id: string; name: string } | null;
}

export interface ClickUpStatus {
  id?: string;
  status: string;
  type: 'open' | 'custom' | 'closed' | string;
  orderindex?: number;
  color?: string;
}

export interface ClickUpTask {
  id: string;
  name: string;
  status: { status: string; type?: string; color?: string };
  url: string;
  list?: { id: string; name?: string };
  date_updated?: string;
  date_created?: string;
}

export interface ListTasksResponse {
  tasks: ClickUpTask[];
  last_page?: boolean;
}

export interface ClickUpClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
}

export class ClickUpClient {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClickUpClientOptions) {
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        Authorization: this.token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    const res = await this.fetchImpl(url, init);
    if (res.status === 401 || res.status === 403) {
      const text = await safeReadText(res);
      throw new ClickUpAuthError(`ClickUp auth failed (${res.status}): ${text.slice(0, 200)}`, res.status);
    }
    if (!res.ok) {
      const text = await safeReadText(res);
      throw new ClickUpApiError(
        `ClickUp ${method} ${path} failed (${res.status})`,
        res.status,
        text.slice(0, 500),
      );
    }
    // Some PUT/DELETE endpoints return empty bodies; tolerate.
    if (res.status === 204) return undefined as unknown as T;
    const text = await res.text();
    if (!text) return undefined as unknown as T;
    return JSON.parse(text) as T;
  }

  getAuthorizedUser(): Promise<{ user: { id: number; username: string; email?: string } }> {
    return this.request('GET', '/user');
  }

  listTeams(): Promise<{ teams: ClickUpTeam[] }> {
    return this.request('GET', '/team');
  }

  listSpaces(teamId: string): Promise<{ spaces: ClickUpSpace[] }> {
    return this.request('GET', `/team/${encodeURIComponent(teamId)}/space?archived=false`);
  }

  /**
   * Returns folder + folderless lists merged into a single array. ClickUp
   * separates them into two endpoints; we always want a flat list-picker.
   */
  async listLists(spaceId: string): Promise<{ lists: ClickUpList[] }> {
    const [folders, folderless] = await Promise.all([
      this.request<{ folders: ClickUpFolder[] }>(
        'GET',
        `/space/${encodeURIComponent(spaceId)}/folder?archived=false`,
      ),
      this.request<{ lists: ClickUpList[] }>(
        'GET',
        `/space/${encodeURIComponent(spaceId)}/list?archived=false`,
      ),
    ]);
    const fromFolders: ClickUpList[] = [];
    for (const folder of folders.folders ?? []) {
      for (const list of folder.lists ?? []) {
        fromFolders.push({
          ...list,
          folder: { id: folder.id, name: folder.name },
        });
      }
    }
    return { lists: [...fromFolders, ...(folderless.lists ?? [])] };
  }

  async getListStatuses(listId: string): Promise<{ statuses: ClickUpStatus[] }> {
    const list = await this.request<{ statuses?: ClickUpStatus[] }>(
      'GET',
      `/list/${encodeURIComponent(listId)}`,
    );
    return { statuses: list.statuses ?? [] };
  }

  /**
   * Paginates `/list/{list_id}/task`. ClickUp returns up to 100 tasks per page
   * and a `last_page` flag.
   */
  async listAllTasksForList(listId: string): Promise<ClickUpTask[]> {
    const tasks: ClickUpTask[] = [];
    for (let page = 0; page < 200; page += 1) {
      const params = new URLSearchParams({
        page: String(page),
        archived: 'false',
        include_closed: 'true',
        subtasks: 'true',
      });
      const res = await this.request<ListTasksResponse>(
        'GET',
        `/list/${encodeURIComponent(listId)}/task?${params.toString()}`,
      );
      const batch = res.tasks ?? [];
      tasks.push(...batch);
      if (res.last_page || batch.length === 0) break;
    }
    return tasks;
  }

  updateTaskStatus(taskId: string, status: string): Promise<void> {
    return this.request('PUT', `/task/${encodeURIComponent(taskId)}`, { status });
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
