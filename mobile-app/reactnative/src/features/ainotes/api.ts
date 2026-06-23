// Estate AI meeting notes (Block 39) — types + dual mock/live api.
import { api } from '@/api/client';

export interface AiNote {
  id: string; estateId: string; meetingId?: string; meetingTitle?: string;
  title: string; summary: string; actionItems: string[]; source: 'generated' | 'manual';
  createdBy: string; createdByName?: string; createdAt: string;
}
export interface GenerateNoteInput { meetingId: string; }

export const USE_MOCK = (process.env.EXPO_PUBLIC_AINOTES_USE_MOCK ?? 'true') !== 'false';
export const AINOTES_API_BASE = '/api/v1/estate/ai-notes';

const H = 3_600_000, iso = (o: number) => new Date(Date.now() + o).toISOString();
let notes: AiNote[] = [
  {
    id: 'n1', estateId: 'est_amber_court', meetingId: 'm1', meetingTitle: 'Q2 General Meeting',
    title: 'Summary — Q2 General Meeting',
    summary: 'Residents reviewed the Q2 budget and agreed to a ₦7,500 service-charge increase to fund the new generator. The security roster was approved with two extra night guards. The pool renovation was deferred to Q3 pending quotes.',
    actionItems: ['Finalise generator vendor contract by month-end', 'Recruit two additional night guards', 'Collect three pool-renovation quotes before Q3'],
    source: 'generated', createdBy: 'admin', createdByName: 'Estate Admin', createdAt: iso(-30 * H),
  },
];
const latency = (ms = 300) => new Promise((r) => setTimeout(r, ms));

export async function listAiNotes(): Promise<AiNote[]> {
  if (USE_MOCK) { await latency(); return notes.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)); }
  const { data } = await api.get<AiNote[]>(AINOTES_API_BASE); return data;
}
export async function generateAiNote(input: GenerateNoteInput): Promise<AiNote> {
  if (USE_MOCK) {
    await latency(900);
    const n: AiNote = { id: `n_${Date.now()}`, estateId: 'est_amber_court', meetingId: input.meetingId, meetingTitle: 'Meeting', title: 'Summary — Meeting', summary: 'Auto-generated summary from the recorded minutes. Key decisions and action items are extracted below.', actionItems: ['Review the generated summary', 'Assign owners to each action item'], source: 'generated', createdBy: 'you', createdByName: 'You', createdAt: new Date().toISOString() };
    notes = [n, ...notes]; return { ...n };
  }
  const { data } = await api.post<AiNote>(`${AINOTES_API_BASE}/generate`, input); return data;
}
