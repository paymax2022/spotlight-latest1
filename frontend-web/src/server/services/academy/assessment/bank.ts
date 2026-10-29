// Supabase-backed operations over the shared academy_question_items bank, scoped
// to the film academy. Import commits DRAFTS only; review is the sole gate to an
// exam-eligible status; draws only ever return APPROVED items.
//
// The answer key (the `answer` jsonb) is read here ONLY to feed the scorer inside
// attempts.ts. Nothing in this module returns `answer` in a learner-facing shape.

import { createAdminClient } from '@/lib/supabase/server';
import { draftContentHash } from './csv';
import type { AnswerKeyEntry } from './scoring';
import type {
  FilmQuestionDraft,
  FilmQuestionOption,
  FilmQuestionAnswerKey,
  ImportReport,
} from './types';

type Db = ReturnType<typeof createAdminClient>;

export const FILM_SCOPE = 'film';

interface BankItemRow {
  id: string;
  external_code: string | null;
  film_stage: string | null;
  film_module_code: string | null;
  film_source_hash: string | null;
  film_points: number | string | null;
  status: string;
  stem: string;
  options: FilmQuestionOption[];
  answer: FilmQuestionAnswerKey;
}

function toInsert(d: FilmQuestionDraft, batchId: string | null): Record<string, unknown> {
  return {
    type: 'mcq',
    stem: d.stem,
    options: d.options,
    answer: { correct: d.answer.correct, explanation: d.answer.explanation ?? null },
    difficulty: 0.5,
    tags: [...d.keywords, `module:${d.moduleCode}`, `stage:${d.stage}`].filter(Boolean),
    status: 'draft',
    external_code: d.externalCode,
    academy_scope: FILM_SCOPE,
    film_stage: d.stage,
    film_module_code: d.moduleCode,
    film_department: d.department,
    film_learning_outcome: d.learningOutcome,
    film_cognitive: d.cognitive,
    film_difficulty: d.difficulty,
    film_keywords: d.keywords,
    film_points: d.points,
    source_version: d.sourceVersion,
    film_source_hash: draftContentHash(d),
    import_batch_id: batchId,
  };
}

export interface CommitResult {
  inserted: number;
  updated: number;
  unchanged: number;
  locked: number; // approved/examined items a reimport refused to mutate
  batchId: string | null;
}

/**
 * Create an import batch record from a validated report. Returns the batch id, or
 * null for a preview-only run the caller will not commit.
 */
export async function createImportBatch(
  db: Db,
  meta: { filename: string; sourceSha256: string | null; report: ImportReport; committed: boolean; createdBy: string | null },
): Promise<string> {
  const { data, error } = await db
    .from('academy_question_import_batches')
    .insert({
      filename: meta.filename,
      source_sha256: meta.sourceSha256,
      total_rows: meta.report.totalRows,
      accepted: meta.report.accepted.length,
      updated: 0,
      rejected: meta.report.rejected.length,
      warned: meta.report.warned.length,
      report: {
        rejected: meta.report.rejected,
        warned: meta.report.warned,
      },
      committed: meta.committed,
      created_by: meta.createdBy,
    })
    .select('id')
    .single();
  if (error) {
    console.error('[film/assessment] import batch insert failed', error);
    throw new Error('Could not record the import batch');
  }
  return (data as { id: string }).id;
}

/**
 * Idempotent commit: each accepted draft becomes a DRAFT item.
 *   - unseen external_code            → insert
 *   - seen, still draft, same hash    → no-op (unchanged)
 *   - seen, still draft, changed hash → update in place (a draft was never examined)
 *   - seen, approved/retired          → NEVER mutate (would alter an examined version)
 */
export async function commitDrafts(
  db: Db,
  drafts: FilmQuestionDraft[],
  batchId: string,
): Promise<CommitResult> {
  let inserted = 0, updated = 0, unchanged = 0, locked = 0;

  for (const d of drafts) {
    const { data: existing } = await db
      .from('academy_question_items')
      .select('id, status, film_source_hash')
      .eq('external_code', d.externalCode)
      .maybeSingle();
    const row = existing as { id: string; status: string; film_source_hash: string | null } | null;

    if (!row) {
      const { error } = await db.from('academy_question_items').insert(toInsert(d, batchId));
      if (error) { console.error('[film/assessment] insert failed', d.externalCode, error); continue; }
      inserted += 1;
      continue;
    }

    if (row.status !== 'draft') { locked += 1; continue; }

    const hash = draftContentHash(d);
    if (row.film_source_hash === hash) { unchanged += 1; continue; }

    const { error } = await db
      .from('academy_question_items')
      .update(toInsert(d, batchId))
      .eq('id', row.id);
    if (error) { console.error('[film/assessment] update failed', d.externalCode, error); continue; }
    updated += 1;
  }

  await db
    .from('academy_question_import_batches')
    .update({ accepted: inserted, updated, rejected: 0, committed: true })
    .eq('id', batchId);

  return { inserted, updated, unchanged, locked, batchId };
}

export type ReviewDecision = 'approve' | 'reject' | 'suspend' | 'reactivate';

const DECISION_STATUS: Record<ReviewDecision, string> = {
  approve: 'approved',
  reject: 'retired',
  suspend: 'retired',
  reactivate: 'approved',
};

/**
 * Apply a reviewer decision. Separation of duties is enforced at the ROUTE (import
 * author holds programs:manage; approve holds scores:manage); here we enforce the
 * legal transition and write the immutable audit row.
 *
 * Only a 'review' or 'draft' item may be approved; only an 'approved' item may be
 * suspended/reactivated. An approved item is content-immutable afterwards — edits
 * must create a new item via reimport, handled in commitDrafts' locked branch.
 */
export async function reviewQuestion(
  db: Db,
  itemId: string,
  reviewerId: string | null,
  decision: ReviewDecision,
  note: string,
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const { data } = await db
    .from('academy_question_items')
    .select('id, status, academy_scope')
    .eq('id', itemId)
    .maybeSingle();
  const item = data as { id: string; status: string; academy_scope: string | null } | null;
  if (!item) return { ok: false, error: 'Question not found' };
  if (item.academy_scope !== FILM_SCOPE) return { ok: false, error: 'Not a film-academy question' };

  const target = DECISION_STATUS[decision];
  const allowedFrom: Record<ReviewDecision, string[]> = {
    approve: ['draft', 'review'],
    reject: ['draft', 'review'],
    suspend: ['approved'],
    reactivate: ['retired'],
  };
  if (!allowedFrom[decision].includes(item.status)) {
    return { ok: false, error: `Cannot ${decision} a ${item.status} question` };
  }

  const { error } = await db.from('academy_question_items').update({ status: target }).eq('id', itemId);
  if (error) { console.error('[film/assessment] review update failed', error); return { ok: false, error: 'Failed to record the decision' }; }

  await db.from('academy_question_reviews').insert({
    question_item_id: itemId,
    reviewer_id: reviewerId,
    decision,
    note,
    from_status: item.status,
    to_status: target,
  });

  return { ok: true, status: target };
}

/** Count approved film items available for an exam's draw scope. Pool preflight. */
export async function poolCount(
  db: Db,
  scope: { stage: string; moduleCodes: string[] },
): Promise<number> {
  let q = db
    .from('academy_question_items')
    .select('id', { count: 'exact', head: true })
    .eq('academy_scope', FILM_SCOPE)
    .eq('status', 'approved')
    .eq('film_stage', scope.stage);
  if (scope.moduleCodes.length > 0) q = q.in('film_module_code', scope.moduleCodes);
  const { count } = await q;
  return count ?? 0;
}

/** Approved items per topic code, for the per-topic publish floor. */
export async function approvedByTopic(
  db: Db,
  scope: { stage: string; moduleCodes: string[] },
): Promise<Map<string, number>> {
  const { data, error } = await db
    .from('academy_question_items')
    .select('id, film_module_code')
    .eq('academy_scope', FILM_SCOPE)
    .eq('status', 'approved')
    .eq('film_stage', scope.stage)
    .in('film_module_code', scope.moduleCodes);
  if (error) { console.error('[film/assessment] per-topic pool read failed', error); throw new Error('Could not check the question pool'); }

  const counts = new Map<string, number>();
  for (const code of scope.moduleCodes) counts.set(code, 0);
  for (const row of (data ?? []) as unknown as Array<{ film_module_code: string }>) {
    counts.set(row.film_module_code, (counts.get(row.film_module_code) ?? 0) + 1);
  }
  return counts;
}

/**
 * Draw approved film items for a stage (+ optional modules). Returns rows with the
 * options/answer needed to build a snapshot and score it. Order is randomised here
 * so the same item pool does not present identically every attempt.
 */
export async function drawApproved(
  db: Db,
  scope: { stage: string; moduleCodes: string[]; count: number },
): Promise<BankItemRow[]> {
  let q = db
    .from('academy_question_items')
    .select('id, external_code, film_stage, film_module_code, film_source_hash, film_points, status, stem, options, answer')
    .eq('academy_scope', FILM_SCOPE)
    .eq('status', 'approved')
    .eq('film_stage', scope.stage);
  if (scope.moduleCodes.length > 0) q = q.in('film_module_code', scope.moduleCodes);
  const { data, error } = await q;
  if (error) { console.error('[film/assessment] draw failed', error); throw new Error('Could not draw questions'); }

  const rows = (data ?? []) as unknown as BankItemRow[];
  // Draw without replacement: take up to `count` distinct items.
  return shuffleRows(rows).slice(0, scope.count);
}

/** The answer keys for a set of drawn items, for the scorer only. */
export async function keysForItems(db: Db, itemIds: string[]): Promise<AnswerKeyEntry[]> {
  if (itemIds.length === 0) return [];
  const { data } = await db
    .from('academy_question_items')
    .select('id, answer')
    .in('id', itemIds);
  return ((data ?? []) as unknown as Array<{ id: string; answer: FilmQuestionAnswerKey }>)
    .map((r) => ({ questionItemId: r.id, correctOptionIds: r.answer?.correct ?? [] }));
}

export interface QuestionListFilter {
  status?: string;
  stage?: string;
  moduleCode?: string;
  topicId?: string;
  q?: string;
  page: number;
  pageSize: number;
}

export interface AdminQuestionRow {
  id: string;
  external_code: string | null;
  film_stage: string | null;
  film_module_code: string | null;
  film_topic_id: string | null;
  film_objective_id: string | null;
  film_review_notes: string | null;
  film_department: string | null;
  film_learning_outcome: string | null;
  film_cognitive: string | null;
  film_difficulty: string | null;
  film_points: number | string | null;
  source_version: string | null;
  status: string;
  stem: string;
  options: FilmQuestionOption[];
  answer: FilmQuestionAnswerKey;
}

/**
 * Admin list of film items (paged, filtered). This is the REVIEW surface, so it
 * DOES expose the answer key — gated by assertAdminPermission and RLS
 * (is_admin()) at every layer, never by a learner route.
 */
export async function listQuestions(
  db: Db,
  f: QuestionListFilter,
): Promise<{ rows: AdminQuestionRow[]; total: number }> {
  const from = (f.page - 1) * f.pageSize;
  const to = from + f.pageSize - 1;
  let q = db
    .from('academy_question_items')
    .select(
      'id, external_code, film_stage, film_module_code, film_department, film_learning_outcome, film_cognitive, film_difficulty, film_points, source_version, status, stem, options, answer, film_topic_id, film_objective_id, film_review_notes',
      { count: 'exact' },
    )
    .eq('academy_scope', FILM_SCOPE);
  if (f.status) q = q.eq('status', f.status);
  if (f.stage) q = q.eq('film_stage', f.stage);
  if (f.moduleCode) q = q.eq('film_module_code', f.moduleCode);
  if (f.topicId) q = q.eq('film_topic_id', f.topicId);
  if (f.q) q = q.or(`stem.ilike.%${f.q}%,external_code.ilike.%${f.q}%`);
  const { data, count, error } = await q.order('external_code', { ascending: true }).range(from, to);
  if (error) { console.error('[film/assessment] list failed', error); throw new Error('Could not load questions'); }
  return { rows: (data ?? []) as unknown as AdminQuestionRow[], total: count ?? 0 };
}

/** One item, admin-shaped (with key) — for the review drawer. */
export async function getQuestion(db: Db, id: string): Promise<AdminQuestionRow | null> {
  const { data } = await db
    .from('academy_question_items')
    .select(
      'id, external_code, film_stage, film_module_code, film_department, film_learning_outcome, film_cognitive, film_difficulty, film_points, source_version, status, stem, options, answer, film_topic_id, film_objective_id, film_review_notes',
    )
    .eq('id', id)
    .eq('academy_scope', FILM_SCOPE)
    .maybeSingle();
  return (data as unknown as AdminQuestionRow | null) ?? null;
}

export interface QuestionEdit {
  stem?: string;
  options?: FilmQuestionOption[];
  correctOptionIds?: string[];
  explanation?: string;
  points?: number;
  filmStage?: string;
  filmModuleCode?: string;
}

/**
 * Edit a DRAFT / REVIEW item in place. An approved or retired item is content-
 * immutable — a reimport creates a new version rather than mutating an examined
 * one — so this refuses to touch those (the same rule commitDrafts enforces via
 * its 'locked' branch). Recomputes the source hash so a later reimport of the
 * original CSV is seen as 'changed', not silently skipped.
 */
export async function editQuestion(
  db: Db,
  id: string,
  edit: QuestionEdit,
): Promise<{ ok: boolean; error?: string }> {
  const { data } = await db
    .from('academy_question_items')
    .select('id, status, academy_scope, external_code, film_stage, film_module_code, options, answer, stem, film_points')
    .eq('id', id)
    .maybeSingle();
  const row = data as { id: string; status: string; academy_scope: string | null } | null;
  if (!row) return { ok: false, error: 'Question not found' };
  if (row.academy_scope !== FILM_SCOPE) return { ok: false, error: 'Not a film-academy question' };
  if (row.status !== 'draft' && row.status !== 'review') {
    return { ok: false, error: `A ${row.status} question is locked; reimport to create a new version.` };
  }

  const patch: Record<string, unknown> = {};
  if (edit.stem !== undefined) patch.stem = edit.stem;
  if (edit.options !== undefined) patch.options = edit.options;
  if (edit.points !== undefined) patch.film_points = edit.points;
  if (edit.filmStage !== undefined) patch.film_stage = edit.filmStage;
  if (edit.filmModuleCode !== undefined) patch.film_module_code = edit.filmModuleCode;
  if (edit.correctOptionIds !== undefined || edit.explanation !== undefined) {
    const current = (row as unknown as { answer?: FilmQuestionAnswerKey }).answer ?? { correct: [] };
    patch.answer = {
      correct: edit.correctOptionIds ?? current.correct ?? [],
      explanation: edit.explanation !== undefined ? edit.explanation : (current.explanation ?? null),
    };
  }

  // Recompute the hash from the stored + edited shape.
  const full = await getQuestion(db, id);
  if (full) {
    const draftLike: FilmQuestionDraft = {
      externalCode: full.external_code ?? id, stage: (edit.filmStage ?? full.film_stage) as string,
      department: full.film_department ?? '', moduleCode: (edit.filmModuleCode ?? full.film_module_code) as string,
      moduleLabel: '', learningOutcome: full.film_learning_outcome ?? '', cognitive: full.film_cognitive ?? '',
      difficulty: full.film_difficulty ?? '', stem: edit.stem ?? full.stem,
      options: edit.options ?? full.options,
      answer: { correct: edit.correctOptionIds ?? full.answer?.correct ?? [], explanation: edit.explanation ?? full.answer?.explanation },
      points: edit.points ?? Number(full.film_points ?? 1), locale: 'en-NG', keywords: [],
      sourceVersion: full.source_version ?? '1.0', owner: '', reviewNotes: '',
    };
    patch.film_source_hash = draftContentHash(draftLike);
  }

  const { error } = await db.from('academy_question_items').update(patch).eq('id', id);
  if (error) { console.error('[film/assessment] edit failed', error); return { ok: false, error: 'Failed to save the edit' }; }
  return { ok: true };
}

/** The review ledger for one item (newest first) — who decided what, and why. */
export async function reviewHistory(db: Db, itemId: string) {
  const { data } = await db
    .from('academy_question_reviews')
    .select('id, reviewer_id, decision, note, from_status, to_status, created_at')
    .eq('question_item_id', itemId)
    .order('created_at', { ascending: false });
  return (data ?? []) as Array<Record<string, unknown>>;
}

export type { BankItemRow as DrawnItem, AnswerKeyEntry };

// Local Fisher-Yates using Math.random; drawing order is a server concern and need
// not be reproducible across attempts.
function shuffleRows<T>(rows: T[]): T[] {
  const out = rows.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}
