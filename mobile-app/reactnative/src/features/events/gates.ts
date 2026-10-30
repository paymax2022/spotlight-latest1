// Door gate selection for the steward scanner and the manual check-in sheet.
// The server records gate.Name as the ticket's checked_in_gate (clamped to 60
// chars, checkin_service.go maxGateNameLen) and groups check-in stats by it, so
// the name is what matters; the id is a stable per-event slug for the scan log.
//
// The choice is remembered per event in memory for the app session only — a
// steward who walks to another door re-picks, and nothing is persisted.
import type { Gate } from './types';

export const MAX_GATE_NAME_LEN = 60;

export const PRESET_GATES = ['Main Entrance', 'VIP'] as const;

export const DEFAULT_GATE_NAME = PRESET_GATES[0];

export function normaliseGateName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_GATE_NAME_LEN);
}

export function gateSlug(name: string): string {
  const slug = normaliseGateName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'main';
}

export function makeGate(eventId: string | undefined, name: string): Gate {
  const clean = normaliseGateName(name) || DEFAULT_GATE_NAME;
  return { id: `${eventId || 'unknown'}:${gateSlug(clean)}`, name: clean };
}

const selected = new Map<string, string>();

export function rememberedGateName(eventId: string | undefined): string {
  return selected.get(eventId || '') ?? DEFAULT_GATE_NAME;
}

export function rememberGateName(eventId: string | undefined, name: string): void {
  const clean = normaliseGateName(name);
  if (clean) selected.set(eventId || '', clean);
}
