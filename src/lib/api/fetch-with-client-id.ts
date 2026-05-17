import { getClientId } from '@/lib/ws/client-id';

export async function fetchWithClientId(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has('x-agent-studio-client-id')) {
    headers.set('x-agent-studio-client-id', getClientId());
  }
  return fetch(input, { ...init, headers });
}
