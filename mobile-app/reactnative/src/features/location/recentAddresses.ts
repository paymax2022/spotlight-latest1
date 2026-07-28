// ── Recent delivery addresses ────────────────────────────────────────────────
// Persists the last few CONFIRMED addresses so the user can re-pick a place in
// one tap instead of re-typing it every order. Stored via the app's existing
// secureStorage wrapper (expo-secure-store on device, localStorage on web) — no
// new native dependency, and the payload is tiny (≤ 6 short JSON records).

import { getSecureItem, setSecureItem } from '@/lib/secureStorage';
import type { ResolvedAddress } from '@/lib/addressLookup';

const KEY = 'recent_addresses_v1';
const MAX = 6;

export interface RecentAddress {
  label: string;
  lat: number;
  lng: number;
  plusCode?: string;
  /** Epoch ms of last use — newest first. */
  usedAt: number;
}

function dedupeKey(a: { lat: number; lng: number; label: string }): string {
  // Round coordinates to ~11 m so the same spot doesn't pile up duplicates.
  return `${a.lat.toFixed(4)},${a.lng.toFixed(4)}|${a.label.trim().toLowerCase()}`;
}

export async function getRecentAddresses(): Promise<RecentAddress[]> {
  try {
    const raw = await getSecureItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentAddress[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r) => typeof r?.lat === 'number' && typeof r?.lng === 'number' && !!r?.label)
      .sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0))
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export async function addRecentAddress(addr: ResolvedAddress): Promise<void> {
  try {
    const existing = await getRecentAddresses();
    const entry: RecentAddress = {
      label: addr.label,
      lat: addr.lat,
      lng: addr.lng,
      plusCode: addr.plusCode,
      usedAt: Date.now(),
    };
    const key = dedupeKey(entry);
    const next = [entry, ...existing.filter((r) => dedupeKey(r) !== key)].slice(0, MAX);
    await setSecureItem(KEY, JSON.stringify(next));
  } catch {
    /* persistence is best-effort — never block the order flow on it */
  }
}
