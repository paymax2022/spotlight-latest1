import type { NavEvent } from './buffer';

export interface SenderDeps {
  getToken: () => Promise<string | null | undefined>;
  baseURL: string;
  post: (url: string, body: unknown, config: Record<string, unknown>) => Promise<unknown>;
}

/** Pure sender: never throws, skips without a token, accepts any HTTP status. */
export function createSender(deps: SenderDeps) {
  return async function send(batch: NavEvent[]): Promise<void> {
    try {
      if (batch.length === 0) return;
      const token = await deps.getToken();
      if (!token) return;
      await deps.post(
        `${deps.baseURL.replace(/\/+$/, '')}/api/v1/telemetry/navigation`,
        { events: batch.map(({ surface, route, occurred_at }) => ({ surface, route, occurred_at })) },
        { headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true },
      );
    } catch { /* swallow everything: telemetry is best-effort */ }
  };
}
