// Estate AI meeting notes (Block 33) — types + dual mock/live api.
// Live mode targets the transcript-based backend: POST /meetings/:mid/ai-notes
// (claude-sonnet-4-6), GET /ai-notes/:id, POST /ai-notes/:id/approve.
import { api } from '@/api/client';

export type AiNoteStatus = 'processing' | 'complete' | 'failed';

export interface AiActionItem {
  task: string;
  assignee?: string;
  dueDate?: string;
}

export interface AiNote {
  id: string;
  estateId: string;
  meetingId?: string;
  title: string;
  transcript?: string;
  summary: string;
  actionItems: AiActionItem[];
  decisions: string[];
  status: AiNoteStatus;
  model?: string;
  createdBy: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
}

export interface GenerateNoteInput {
  meetingId: string;
  title?: string;
  transcript: string;
}

export const USE_MOCK = (process.env.EXPO_PUBLIC_AINOTES_USE_MOCK ?? 'true') !== 'false';
export const AINOTES_API_BASE = '/api/v1/estate/ai-notes';
export const AINOTES_MEETINGS_BASE = '/api/v1/estate/meetings';

export const AI_NOTE_STATUS_META: Record<AiNoteStatus, { label: string; color: string; bg: string }> = {
  processing: { label: 'Processing', color: '#B26B00', bg: 'rgba(245,158,11,0.12)' },
  complete: { label: 'Complete', color: '#16A34A', bg: 'rgba(22,163,74,0.12)' },
  failed: { label: 'Failed', color: '#DC2626', bg: 'rgba(220,38,38,0.12)' },
};

// fromApi maps the snake_case backend payload to the camelCase client shape.
function fromApi(r: any): AiNote {
  const items: AiActionItem[] = ((r.action_items ?? []) as any[]).map((x: any) =>
    typeof x === 'string'
      ? { task: x }
      : { task: x.task ?? '', assignee: x.assignee || undefined, dueDate: x.due_date || undefined },
  );
  return {
    id: r.id,
    estateId: r.estate_id,
    meetingId: r.meeting_id ?? undefined,
    title: r.title ?? '',
    transcript: r.transcript ?? undefined,
    summary: r.summary ?? '',
    actionItems: items,
    decisions: (r.decisions ?? []) as string[],
    status: (r.status ?? 'complete') as AiNoteStatus,
    model: r.model ?? undefined,
    createdBy: r.created_by ?? '',
    approvedBy: r.approved_by ?? null,
    approvedAt: r.approved_at ?? null,
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

// ── mock store ────────────────────────────────────────────────────────────────
const H = 3_600_000;
const iso = (o: number) => new Date(Date.now() + o).toISOString();
let notes: AiNote[] = [
  {
    id: 'n1', estateId: 'est_amber_court', meetingId: 'm1', title: 'Q2 General Meeting',
    summary:
      'Residents reviewed the Q2 budget and agreed to a ₦7,500 service-charge increase to fund the new generator. The security roster was approved with two extra night guards. Pool renovation deferred to Q3 pending quotes.',
    actionItems: [
      { task: 'Finalise generator vendor contract', assignee: 'Ada', dueDate: '2026-07-31' },
      { task: 'Recruit two additional night guards', assignee: 'Security lead' },
      { task: 'Collect three pool-renovation quotes', dueDate: '2026-09-01' },
    ],
    decisions: ['Approve ₦7,500 service-charge increase', 'Approve expanded night-guard roster'],
    status: 'complete', model: 'claude-sonnet-4-6', createdBy: 'admin',
    approvedBy: null, approvedAt: null, createdAt: iso(-30 * H),
  },
];
const latency = (ms = 300) => new Promise((r) => setTimeout(r, ms));

export async function listAiNotes(): Promise<AiNote[]> {
  if (USE_MOCK) {
    await latency();
    return notes.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  const res = await api.get(AINOTES_API_BASE);
  const rows = (res.data?.data ?? res.data ?? []) as any[];
  return rows.map(fromApi);
}

export async function getAiNote(id: string): Promise<AiNote> {
  if (USE_MOCK) {
    await latency();
    const n = notes.find((x) => x.id === id);
    if (!n) throw new Error('not found');
    return { ...n };
  }
  const { data } = await api.get(`${AINOTES_API_BASE}/${id}`);
  return fromApi(data);
}

export async function generateAiNote(input: GenerateNoteInput): Promise<AiNote> {
  if (USE_MOCK) {
    await latency(900);
    const n: AiNote = {
      id: `n_${Date.now()}`, estateId: 'est_amber_court', meetingId: input.meetingId,
      title: input.title || 'Meeting notes',
      summary: 'Auto-generated summary from the transcript. Key decisions and action items are extracted below.',
      actionItems: [{ task: 'Review the generated summary' }, { task: 'Assign owners to each action item' }],
      decisions: ['Adopt the proposed agenda'],
      status: 'complete', model: 'claude-sonnet-4-6', createdBy: 'you',
      approvedBy: null, approvedAt: null, createdAt: new Date().toISOString(),
    };
    notes = [n, ...notes];
    return { ...n };
  }
  const { data } = await api.post(`${AINOTES_MEETINGS_BASE}/${input.meetingId}/ai-notes`, {
    title: input.title,
    transcript: input.transcript,
  });
  return fromApi(data);
}

export async function approveAiNote(id: string): Promise<void> {
  if (USE_MOCK) {
    await latency();
    notes = notes.map((n) => (n.id === id ? { ...n, approvedBy: 'admin', approvedAt: new Date().toISOString() } : n));
    return;
  }
  await api.post(`${AINOTES_API_BASE}/${id}/approve`);
}
