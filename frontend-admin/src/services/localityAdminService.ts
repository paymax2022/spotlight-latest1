/**
 * Locality reference data for the console — the two tiers an admin cannot type.
 *
 * The contest editor needs a state → local government → village cascade, and the
 * console has neither of the sources the other two apps use: the LGA table is a
 * constant inside frontend-web's bundle (`reference-data.ts`), and the village list
 * lives in `public.villages`, curated through the web app's admin API. Copying a
 * 774-row table into this bundle would guarantee the two apps disagree the first time
 * one of them is corrected, so the console reads the same two endpoints the registration
 * wizard does — over the web proxy, the same PATH A the contest writes use.
 *
 * The returned shape is deliberately the route's own payload, not a flattened
 * `{ mode, values }`: one vocabulary for the whole feature means a mock in a test
 * looks like the response the server actually sends, instead of a third shape only
 * this file's tests agree on.
 *
 * Both answers carry `mode`. That is the contract that keeps the feature honest:
 * 'curated' means render a dropdown, 'free_text' means render a box, because village
 * data is incomplete by design and an admin must still be able to scope a contest to a
 * quarter nobody has published. A failed fetch degrades the same way — the caller keeps
 * a text box — so a village-list outage can never block saving a contest.
 */
import { webProxyBase } from '@/config/env';

export type LocalityMode = 'curated' | 'free_text';

export interface LgaList {
  /** The canonical state key the list was found under. */
  state: string;
  mode: LocalityMode;
  /** Alphabetical, never null — an absent list is []. */
  lgas: string[];
}

export interface VillageList {
  state: string;
  lga: string;
  mode: LocalityMode;
  villages: string[];
}

// The server already sorts and trims, but a null from a proxy error page must not
// reach a `.map()` in the editor.
function names(raw: unknown): string[] {
  return Array.isArray(raw)
    ? [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()))]
        .sort((a, b) => a.localeCompare(b))
    : [];
}

function mode(raw: unknown): LocalityMode {
  return raw === 'curated' ? 'curated' : 'free_text';
}

async function getJson(url: string, label: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { cache: 'no-store' });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // The route's own sentence, not a generic "request failed": an admin who is told
    // which level is missing can fix that level.
    throw new Error(`${label} failed: ${(json.error as string) || res.status}`);
  }
  return json;
}

/**
 * The local governments of one state. An unknown state answers free_text with [], so
 * the editor falls back to a box the admin types into and the value is stored verbatim.
 */
export async function listLocalGovernments(state: string): Promise<LgaList> {
  const url = `${webProxyBase()}/api/registration/lgas?state=${encodeURIComponent(state)}`;
  const json = await getJson(url, 'Local government list');
  return { state: String(json.state ?? state), mode: mode(json.mode), lgas: names(json.lgas) };
}

/**
 * The curated villages under one (state, LGA) pair — the tier the whole feature exists
 * to supply. Onitsha North's 15 published quarters become a dropdown here; any other
 * LGA stays a text box.
 */
export async function listVillages(state: string, lga: string): Promise<VillageList> {
  const qs = `state=${encodeURIComponent(state)}&lga=${encodeURIComponent(lga)}`;
  const json = await getJson(`${webProxyBase()}/api/registration/villages?${qs}`, 'Village list');
  return { state: String(json.state ?? state), lga: String(json.lga ?? lga), mode: mode(json.mode), villages: names(json.villages) };
}
