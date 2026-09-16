// ── Association — AI note-taking API wrapper (L) ──────────────────────────────
// Mock-flagged. AI assists; humans approve/publish.

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK, ASSOCIATION_API_BASE as BASE } from '../constants/association.constants';
import type {
  AiNote,
  AiNoteSummary,
  CreateAiNoteInput,
  AiNoteStatus,
} from '../types/ainotes.types';
import { MOCK_AI_NOTES } from './ainotes.mock';

const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// Every write below has a real live endpoint (verified against
// backend/internal/association/routes.go and a full green run of
// backend/tests/association), so fixture mode has nothing to add and refuses
// loudly instead of reporting a write it did not perform — mirrors
// frontend-admin's crowdfundingAdminService.ts NOT_IN_FIXTURE_MODE pattern.
const notInFixtureMode = (action: string) =>
  new Error(`${action} is unavailable in fixture mode: this app will not report a write it did not perform. Set EXPO_PUBLIC_ASSOCIATION_USE_MOCK=false to send this against the live backend.`);

/** Shape returned by POST /ai-notes/{id}/regenerate-summary. */
export interface RegenerateResult { ok: boolean; status?: AiNoteStatus }

const toSummary = (n: AiNote): AiNoteSummary => {
  const { id, meetingTitle, status, source, createdAt, durationLabel } = n;
  return { id, meetingTitle, status, source, createdAt, durationLabel };
};

export async function getAiNotes(): Promise<AiNoteSummary[]> {
  if (USE_MOCK) { await delay(); return MOCK_AI_NOTES.map(toSummary); }
  const { data } = await api.get(`${BASE}/ai-notes`);
  return data;
}

export async function getAiNote(id: string): Promise<AiNote> {
  if (USE_MOCK) {
    await delay();
    // A freshly-created mock id resolves to a generated READY note.
    const found = MOCK_AI_NOTES.find((n) => n.id === id);
    if (found) return found;
    return synthReadyNote(id);
  }
  const { data } = await api.get(`${BASE}/ai-notes/${id}`);
  return data;
}

export async function createAiNote(input: CreateAiNoteInput): Promise<{ id: string; status: AiNoteStatus }> {
  if (USE_MOCK) throw notInFixtureMode('Creating an AI note');
  const { data } = await api.post(`${BASE}/ai-notes`, input, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}

/** Poll/await processing completion. Mock resolves to READY after a short delay. */
export async function awaitProcessing(id: string): Promise<{ status: AiNoteStatus }> {
  if (USE_MOCK) { await delay(2200); return { status: 'READY' }; }
  const { data } = await api.get(`${BASE}/ai-notes/${id}/status`);
  return data;
}

/**
 * Ask the backend to regenerate the executive summary.
 *
 * The Go handler answers `{ ok, status }` — it does NOT return the new text, so
 * the caller must re-fetch the note (see `useRegenerateSummary`, which
 * invalidates the note query). The old contract assumed `{ summary }` and left
 * the screen showing `undefined` after a successful regeneration.
 */
export async function regenerateSummary(id: string): Promise<RegenerateResult> {
  if (USE_MOCK) throw notInFixtureMode('Regenerating the AI note summary');
  const { data } = await api.post(`${BASE}/ai-notes/${id}/regenerate-summary`, {}, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return { ok: data?.ok ?? true, status: data?.status };
}

export async function approveAiNote(id: string): Promise<{ ok: true }> {
  if (USE_MOCK) throw notInFixtureMode('Approving an AI note');
  const { data } = await api.post(`${BASE}/ai-notes/${id}/approve`, {}, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}

export async function publishAiNote(id: string): Promise<{ ok: true }> {
  if (USE_MOCK) throw notInFixtureMode('Publishing an AI note');
  const { data } = await api.post(`${BASE}/ai-notes/${id}/publish`, {}, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}

export async function convertActionItem(noteId: string, actionItemId: string): Promise<{ taskId: string }> {
  if (USE_MOCK) throw notInFixtureMode('Converting an action item to a task');
  const { data } = await api.post(
    `${BASE}/ai-notes/${noteId}/action-items/${actionItemId}/convert`,
    {},
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  return data;
}

// ── Mock helper: synthesise a freshly-processed note ──────────────────────────
function synthReadyNote(id: string): AiNote {
  return {
    id,
    meetingTitle: 'New meeting recording',
    status: 'READY',
    source: 'RECORD',
    createdAt: new Date().toISOString(),
    durationLabel: '47m',
    meetingId: null,
    summary:
      'The meeting covered routine chapter business, agreed on two action items, and noted one unresolved matter for follow-up.',
    minutes:
      '1. Opening and adoption of agenda.\n2. Review of pending matters.\n3. New business and action items.\n4. Any other business.\n5. Closing.',
    decisions: [{ id: 'nd1', text: 'Adopt the proposed agenda as circulated.' }],
    actionItems: [
      { id: 'na1', title: 'Circulate draft minutes for review', owner: 'Secretary', dueLabel: 'in 3 days', convertedTaskId: null },
      { id: 'na2', title: 'Follow up on outstanding dues list', owner: 'Treasurer', dueLabel: 'in 7 days', convertedTaskId: null },
    ],
    unresolved: ['Date for the next extraordinary meeting to be confirmed.'],
    financialCommitments: [],
    attendees: [
      { id: 'nat1', name: 'Dr. Chidinma Okeke', present: true },
      { id: 'nat2', name: 'Dr. Adebayo Williams', present: true },
    ],
    transcriptPreview: 'Chair: Let us begin… (auto-generated transcript preview).',
  };
}
