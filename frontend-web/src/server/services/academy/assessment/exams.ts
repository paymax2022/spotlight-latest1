// Admin exam authoring over academy_exams, plus the publish-time pool preflight.
//
// Publishing is the gate that a DRAFT-heavy bank cannot accidentally satisfy:
// an exam only publishes when its draw scope (stage + optional modules) has at
// least draw_count APPROVED items. Importing can never reach here on its own, so
// the 256 starter questions are exam-ineligible until SME review promotes them.

import { createAdminClient } from '@/lib/supabase/server';
import { poolCount } from './bank';
import type { ExamRow } from './attempts';

type Db = ReturnType<typeof createAdminClient>;

export interface ExamInput {
  program_id: string;
  title: string;
  description?: string | null;
  kind?: string;
  pass_mark?: number;
  time_limit_minutes?: number;
  max_attempts?: number;
  /** ISO timestamps; the exam is only reachable inside [opens_at, closes_at). */
  opens_at?: string | null;
  closes_at?: string | null;
  draw_stage?: string | null;
  draw_module_codes?: string[];
  draw_count?: number;
}

const SELECT =
  'id, program_id, title, description, kind, pass_mark, time_limit_minutes, max_attempts, is_published, opens_at, closes_at, draw_stage, draw_module_codes, draw_count';

/** Every exam for a programme (admin sees unpublished ones too). */
export async function listAllExams(db: Db, programId: string | null): Promise<ExamRow[]> {
  let q = db.from('academy_exams').select(SELECT);
  if (programId) q = q.eq('program_id', programId);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) { console.error('[film/assessment] admin exam list failed', error); throw new Error('Could not load exams'); }
  return (data ?? []) as unknown as ExamRow[];
}

export async function createExam(db: Db, input: ExamInput, createdBy: string | null): Promise<ExamRow | null> {
  const { data, error } = await db
    .from('academy_exams')
    .insert({
      program_id: input.program_id,
      title: input.title,
      description: input.description ?? '',
      kind: input.kind ?? 'stage_exam',
      pass_mark: clampInt(input.pass_mark ?? 70, 0, 100),
      time_limit_minutes: Math.max(1, Math.floor(input.time_limit_minutes ?? 30)),
      max_attempts: Math.max(1, Math.floor(input.max_attempts ?? 1)),
      opens_at: toIso(input.opens_at),
      closes_at: toIso(input.closes_at),
      draw_stage: input.draw_stage ?? null,
      draw_module_codes: input.draw_module_codes ?? [],
      draw_count: clampInt(input.draw_count ?? 10, 1, 200),
      is_published: false,
      created_by: createdBy,
    })
    .select(SELECT)
    .single();
  if (error) { console.error('[film/assessment] create exam failed', error); throw new Error('Could not create the exam'); }
  return (data as unknown as ExamRow) ?? null;
}

export async function updateExam(db: Db, id: string, input: Partial<ExamInput>, updatedBy: string | null): Promise<ExamRow | null> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: updatedBy };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description ?? '';
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.pass_mark !== undefined) patch.pass_mark = clampInt(input.pass_mark, 0, 100);
  if (input.time_limit_minutes !== undefined) patch.time_limit_minutes = Math.max(1, Math.floor(input.time_limit_minutes));
  if (input.max_attempts !== undefined) patch.max_attempts = Math.max(1, Math.floor(input.max_attempts));
  if (input.opens_at !== undefined) patch.opens_at = toIso(input.opens_at);
  if (input.closes_at !== undefined) patch.closes_at = toIso(input.closes_at);
  if (input.draw_stage !== undefined) patch.draw_stage = input.draw_stage;
  if (input.draw_module_codes !== undefined) patch.draw_module_codes = input.draw_module_codes;
  if (input.draw_count !== undefined) patch.draw_count = clampInt(input.draw_count, 1, 200);

  const { data, error } = await db.from('academy_exams').update(patch).eq('id', id).select(SELECT).maybeSingle();
  if (error) { console.error('[film/assessment] update exam failed', error); throw new Error('Could not update the exam'); }
  return (data as unknown as ExamRow | null) ?? null;
}

export interface PublishPreflight {
  published: boolean;
  reason?: string;
  poolSize?: number;
  required?: number;
}

/**
 * Publish only when the exam is well-formed AND its approved pool covers the draw.
 * A failed preflight leaves the exam unpublished and tells the admin exactly what
 * to fix (more approved questions, or lower the count).
 */
export async function publishExam(db: Db, id: string): Promise<PublishPreflight> {
  const { data } = await db.from('academy_exams').select(SELECT).eq('id', id).maybeSingle();
  const exam = data as unknown as ExamRow | null;
  if (!exam) return { published: false, reason: 'Exam not found' };
  if (!exam.draw_stage) return { published: false, reason: 'Set a content stage before publishing.' };
  if (!exam.opens_at || !exam.closes_at) {
    return { published: false, reason: 'Set a start time and an end time before publishing.' };
  }
  if (new Date(exam.closes_at).getTime() <= new Date(exam.opens_at).getTime()) {
    return { published: false, reason: 'The end time must be after the start time.' };
  }
  const required = exam.draw_count ?? 10;

  const pool = await poolCount(db, { stage: exam.draw_stage, moduleCodes: exam.draw_module_codes ?? [] });
  if (pool < required) {
    return {
      published: false, poolSize: pool, required,
      reason: `Only ${pool} approved question${pool === 1 ? '' : 's'} cover this scope; at least ${required} are needed. Review more questions or lower the draw count.`,
    };
  }

  const { error } = await db.from('academy_exams').update({ is_published: true, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { console.error('[film/assessment] publish failed', error); return { published: false, reason: 'Could not publish the exam.' }; }
  return { published: true, poolSize: pool, required };
}

export async function unpublishExam(db: Db, id: string): Promise<boolean> {
  const { error } = await db.from('academy_exams').update({ is_published: false, updated_at: new Date().toISOString() }).eq('id', id);
  return !error;
}

/** A valid ISO instant, or null (unbounded). Garbage is rejected as null rather than stored. */
function toIso(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function clampInt(v: number, lo: number, hi: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
