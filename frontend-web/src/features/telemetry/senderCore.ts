import type { NavEvent } from './buffer';

export interface SenderDeps {
  getToken: () => Promise<string | null | undefined>;
  /** Already includes /api/v1 (NEXT_PUBLIC_API_BASE_URL). */
  baseURL: string;
  post: (
    url: string,
    body: unknown,
    init: { headers: Record<string, string>; keepalive: boolean },
  ) => Promise<unknown>;
}

/** Pure sender: never throws, skips without a token, ignores HTTP status. */
export function createSender(deps: SenderDeps) {
  return async function send(batch: NavEvent[]): Promise<void> {
    try {
      if (batch.length === 0) return;
      const token = await deps.getToken();
      if (!token) return;
      await deps.post(
        `${deps.baseURL.replace(/\/+$/, '')}/telemetry/navigation`,
        { events: batch.map(({ surface, route, occurred_at }) => ({ surface, route, occurred_at })) },
        { headers: { Authorization: `Bearer ${token}` }, keepalive: true },
      );
    } catch { /* swallow everything: telemetry is best-effort */ }
  };
}
