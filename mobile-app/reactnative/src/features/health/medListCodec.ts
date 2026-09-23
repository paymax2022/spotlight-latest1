// ── Medication list codec (med_list field, M6) ────────────────────────────────
// Stored as a JSON string of {name, dose} so it fits IntakeValue (string) and the
// answers payload without a schema/type change. Tolerates a legacy plain-text
// value (treated as a single medication name).
//
// Split out of IntakeField.tsx (which imports react-native) so it can be unit
// tested with plain node:test — no RN runtime required.
import type { IntakeValue } from './types';

export type Med = { name: string; dose: string };

export function parseMeds(v: IntakeValue): Med[] {
  if (typeof v !== 'string' || !v.trim()) return [];
  try {
    const arr = JSON.parse(v);
    if (Array.isArray(arr)) return arr.map((m) => ({ name: String(m?.name ?? ''), dose: String(m?.dose ?? '') }));
  } catch { /* legacy free-text → one med */ }
  return [{ name: v, dose: '' }];
}

export function serializeMeds(meds: Med[]): IntakeValue {
  // Blank rows are kept as-is — the user may have just clicked "add another"
  // and not typed into it yet. Stripping them here (as this used to) meant a
  // freshly-added blank row was dropped before the next render ever saw it,
  // so "Add another medication" appeared to do nothing. Whether the field
  // still counts as "empty" for validation is handled by isEmpty() via
  // formatMedList(), which already ignores blank rows.
  return meds.length ? JSON.stringify(meds) : '';
}
