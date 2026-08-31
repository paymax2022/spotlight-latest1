// ── Insurance (live) — the in-flight purchase draft ─────────────────────────
// A purchase spans four screens (form → review → result), and route params are
// the wrong place to carry a filled-in application: they are strings, they end
// up in logs and deep links, and this draft holds PII (NIN, date of birth, a
// photo URL). So the draft lives in memory for the length of the attempt and is
// referenced by an opaque id.
//
// The single most important thing here is the IDEMPOTENCY KEY. It is minted
// ONCE, when the draft is created, and every retry of that same purchase reuses
// it verbatim. Regenerating a key on retry is exactly how a person gets charged
// twice for one policy.

import { newIdempotencyKey } from './api';
import type { FormValues, Product, Quote } from './types';

export interface PurchaseDraft {
  id: string;
  /** The plan the user chose — its code is what we quote and buy. */
  product: Product;
  /** Answers to the family's form schema. */
  values: FormValues;
  /** Server-priced quote. Absent until the form is submitted. */
  quote: Quote | null;
  /** Minted once per draft; reused verbatim on every retry. */
  idempotencyKey: string;
  createdAt: number;
}

const DRAFTS = new Map<string, PurchaseDraft>();

/** Drop drafts older than this so abandoned PII does not linger in memory. */
const TTL_MS = 30 * 60_000;

function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, draft] of DRAFTS) {
    if (draft.createdAt < cutoff) DRAFTS.delete(id);
  }
}

export function createDraft(product: Product, values: FormValues = {}): PurchaseDraft {
  sweep();
  const id = `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const draft: PurchaseDraft = {
    id,
    product,
    values,
    quote: null,
    idempotencyKey: newIdempotencyKey('purchase'),
    createdAt: Date.now(),
  };
  DRAFTS.set(id, draft);
  return draft;
}

export function getDraft(id: string | undefined | null): PurchaseDraft | null {
  if (!id) return null;
  return DRAFTS.get(id) ?? null;
}

export function updateDraft(id: string, patch: Partial<Omit<PurchaseDraft, 'id' | 'idempotencyKey'>>): PurchaseDraft | null {
  const current = DRAFTS.get(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  DRAFTS.set(id, next);
  return next;
}

/** Called once the policy is confirmed, or the user abandons the attempt. */
export function discardDraft(id: string | undefined | null): void {
  if (id) DRAFTS.delete(id);
}
