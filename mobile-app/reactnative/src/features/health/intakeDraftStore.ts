// ── Pre-Consult intake — offline draft store ─────────────────────────────────
// Persists the in-progress wizard answers locally so the patient can complete
// the intake offline; reconciled with the server draft on next load and cleared
// on submit (PRD §3 offline-first; M3 resume).
//
// SecureStore keys may only contain [A-Za-z0-9._-] — colons are NOT allowed, so
// the appointment id is sanitised into the key.

import { getSecureItem, setSecureItem, deleteSecureItem } from '@/lib/secureStorage';
import type { IntakeResponseValues } from './types';

const sanitize = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, '_');
const keyFor = (appointmentId: string) => `intake_draft.${sanitize(appointmentId)}`;

export async function getIntakeDraft(appointmentId: string): Promise<IntakeResponseValues | null> {
  try {
    const raw = await getSecureItem(keyFor(appointmentId));
    if (!raw) return null;
    return JSON.parse(raw) as IntakeResponseValues;
  } catch {
    return null;
  }
}

export async function setIntakeDraft(appointmentId: string, values: IntakeResponseValues): Promise<void> {
  try {
    await setSecureItem(keyFor(appointmentId), JSON.stringify(values));
  } catch {
    /* best-effort — autosave to server still runs */
  }
}

export async function clearIntakeDraft(appointmentId: string): Promise<void> {
  try {
    await deleteSecureItem(keyFor(appointmentId));
  } catch {
    /* ignore */
  }
}
