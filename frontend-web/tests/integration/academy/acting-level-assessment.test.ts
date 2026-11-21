/**
 * The Acting level tests, driven through the real learner service against a real
 * database.
 *
 * WHY THIS IS NOT COVERED BY THE UNIT SUITE. tests/unit/academy/acting-level-assessment.test.ts
 * reads the seed migration as text and asserts its shape — it never touches a
 * database, because hermetic specs cannot execute `jsonb_to_recordset`, the
 * `WHERE NOT EXISTS` guard, or the draw query itself. This spec closes that gap:
 * it runs
 * `resolveLearner → listLearnerExams → startAttempt → saveResponse → submitAttempt`
 * through the production code paths and grades real papers.
 *
 * What would break silently without it:
 *   - an exam whose draw scope is a stage alone, which would hand the learner the
 *     legacy 256-question bank instead of the 20-question Acting paper;
 *   - pass_mark / draw_count / film_points that agree in theory but not in the
 *     scorer's integer arithmetic, so 17 of 20 is not the 85% the pack promises;
 *   - the answer key escaping into a learner payload.
 *
 * Each spec sits its OWN level paper, so no spec depends on another's attempt
 * count — the attempt ceiling is three, and a retake spec needs all of them.
 *
 * Local only, like tests/integration/profile: CI has no PostgREST here, so this
 * skips itself rather than reporting a green that ran nothing.
 *
 *   set -a; source frontend-web/.env.local; set +a
 *   cd frontend-web && npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { resolveLearner } from '@/src/server/services/academy';
import {
  loadPublishedExam,
  listLearnerExams,
  startAttempt,
  saveResponse,
  submitAttempt,
  readAttempt,
  type LearnerExamSummary,
  type LearnerRef,
} from '@/src/server/services/academy/assessment';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(URL && KEY);
const db = () => createClient(URL as string, KEY as string, { auth: { persistSession: false } });

const STAMP = Date.now();
const EMAIL = `acting-level-${STAMP}@seed.test`;
// The only local batch, carrying no programme of its own and a zero fee — so the
// enrolment falls through to the default curriculum, which is what the seed targets.
const BATCH_ID = '90008aaa-9a7b-40cc-b8a3-09e578cf94dc';

let userId = '';
let applicationId = '';
let learner: LearnerRef = { enrollmentId: '', programId: null, batchId: null };

type SnapshotItem = {
  attemptQuestionId: string;
  questionItemId: string;
  optionMap: Record<string, string>;
};

/** The key, read the way an examiner reads it: straight from the bank row. */
async function keysFor(itemIds: string[]): Promise<Map<string, { correct: string; explanation: string }>> {
  const { data, error } = await db()
    .from('academy_question_items')
    .select('id, answer')
    .eq('academy_scope', 'film')
    .in('id', itemIds);
  if (error) throw new Error(`key read failed: ${error.message}`);
  return new Map(((data ?? []) as any[]).map((r) => [
    r.id as string,
    { correct: (r.answer.correct as string[])[0], explanation: String(r.answer.explanation ?? '') },
  ]));
}

async function examFor(heading: 'Beginner' | 'Intermediate' | 'Advanced'): Promise<LearnerExamSummary> {
  const exams = await listLearnerExams(db(), learner);
  const found = exams.find((e) => e.title === `Acting for Camera — ${heading} Level Test`);
  expect(found, `the ${heading} level test must be offered to this learner`).toBeTruthy();
  return found!;
}

/** The immutable draw a started attempt stored, in presentation order. */
async function snapshotOf(attemptId: string): Promise<SnapshotItem[]> {
  const { data } = await db()
    .from('academy_exam_attempts')
    .select('item_snapshot')
    .eq('id', attemptId)
    .single();
  return (data as any).item_snapshot as SnapshotItem[];
}

const DECOY_TAG = `ACT-Z-${STAMP}`;

/**
 * Approved L1 film questions that belong to no Acting topic. They exist so the
 * draw spec can tell a pinned scope from a stage-only scope: with the pin gone,
 * `drawApproved` filters on stage alone and these enter the paper.
 */
async function seedL1Decoys(n: number): Promise<void> {
  const codes = Array.from({ length: n }, (_, i) => `${DECOY_TAG}-${i}`);
  const rows = codes.map((code, i) => ({
    type: 'mcq',
    stem: `Decoy ${code}: an unrelated L1 question that must never reach the Acting paper.`,
    options: [
      { id: 'a', text: `decoy option ${i}a` }, { id: 'b', text: `decoy option ${i}b` },
      { id: 'c', text: `decoy option ${i}c` }, { id: 'd', text: `decoy option ${i}d` },
    ],
    answer: { correct: ['a'], explanation: `Decoy rationale ${i}.` },
    status: 'approved',
    academy_scope: 'film',
    film_stage: 'L1',
    film_module_code: 'FM01',
    film_points: 1,
    external_code: code,
  }));
  const { error } = await db().from('academy_question_items').insert(rows);
  if (error) throw new Error(`decoy seed failed: ${error.message}`);
}

/** Backs the decoys out even if a spec failed while they were drawn and saved. */
async function removeDecoys(): Promise<void> {
  const client = db();
  const { data: items } = await client
    .from('academy_question_items').select('id').like('external_code', `${DECOY_TAG}-%`);
  const ids = ((items ?? []) as any[]).map((r) => r.id);
  if (ids.length) {
    // A decoy that leaked into a paper is referenced by its responses, so those
    // go first — otherwise the cleanup fails and the pool stays poisoned.
    const { data: responses } = await client
      .from('academy_exam_attempt_responses').select('id').in('question_item_id', ids);
    const responseIds = ((responses ?? []) as any[]).map((r) => r.id);
    if (responseIds.length) await client.from('academy_exam_attempt_responses').delete().in('id', responseIds);
  }
  await client.from('academy_question_items').delete().like('external_code', `${DECOY_TAG}-%`);
}

/**
 * Sit one paper: draw it, then answer exactly `rightCount` questions correctly and
 * the rest with one of its distractors. Returns the server's receipt, the learner's
 * own final view (the surface a key would leak through) and the draw.
 */
async function sitPaper(examId: string, rightCount: number, idem: string) {
  const exam = await loadPublishedExam(db(), examId);
  expect(exam, 'the level test must be published for the learner to reach it').not.toBeNull();

  const started = await startAttempt(db(), exam!, learner, userId, idem);
  const snapshot = await snapshotOf(started.attemptId);
  expect(started.questionCount).toBe(snapshot.length);

  const keys = await keysFor(snapshot.map((s) => s.questionItemId));
  let markedRight = 0;
  for (const s of snapshot) {
    const key = keys.get(s.questionItemId);
    expect(key, 'every drawn item must carry a key').toBeTruthy();
    const wanted = markedRight < rightCount
      ? key!.correct
      : (['a', 'b', 'c', 'd'] as const).find((o) => o !== key!.correct)!;
    if (wanted === key!.correct) markedRight += 1;
    const presentationOptionId = Object.keys(s.optionMap).find((p) => s.optionMap[p] === wanted);
    expect(presentationOptionId, 'the option the learner picks must be in this paper').toBeTruthy();
    await saveResponse(db(), started.attemptId, learner, s.attemptQuestionId, presentationOptionId!);
  }
  expect(markedRight).toBe(rightCount);

  const receipt = await submitAttempt(db(), started.attemptId, learner);
  return { receipt, view: await readAttempt(db(), started.attemptId, learner), snapshot, started };
}

// One paper is 20 saveResponse calls through PostgREST, and the retake spec sits
// three of them. The 5s default is a unit-test budget, not a network one.
describe.skipIf(!live)('Acting level assessment end to end', () => {
  beforeAll(async () => {
    const client = db();
    const { data: created, error } = await client.auth.admin.createUser({
      email: EMAIL, email_confirm: true, user_metadata: { full_name: 'Acting Seed Learner' },
    });
    if (error || !created.user) throw new Error(`test user: ${error?.message ?? 'none created'}`);
    userId = created.user.id;

    const { data: app, error: appErr } = await client
      .from('academy_applications')
      .insert({
        user_id: userId, batch_id: BATCH_ID, full_name: 'Acting Seed Learner',
        email: EMAIL, phone: '08000000000', status: 'approved', tuition_total_ngn: 0,
      })
      .select('id')
      .single();
    if (appErr || !app) throw new Error(`test application: ${appErr?.message ?? 'none created'}`);
    applicationId = (app as { id: string }).id;

    const resolved = await resolveLearner(client, userId);
    if (!resolved.ok) throw new Error(`learner did not resolve: ${resolved.reason}`);
    learner = {
      enrollmentId: resolved.enrollmentId,
      programId: resolved.programId,
      batchId: resolved.batchId,
    };
  });

  afterAll(async () => {
    const client = db();
    await removeDecoys();
    if (learner.enrollmentId) {
      const { data: attempts } = await client
        .from('academy_exam_attempts').select('id').eq('enrollment_id', learner.enrollmentId);
      const ids = ((attempts ?? []) as any[]).map((a) => a.id);
      if (ids.length) {
        await client.from('academy_exam_attempt_responses').delete().in('attempt_id', ids);
        await client.from('academy_exam_attempts').delete().in('id', ids);
      }
      await client.from('academy_enrollments').delete().eq('id', learner.enrollmentId);
    }
    if (applicationId) await client.from('academy_applications').delete().eq('id', applicationId);
    if (userId) await client.auth.admin.deleteUser(userId);
  });

  it('offers the acting student all three level tests as startable', async () => {
    const exams = await listLearnerExams(db(), learner);
    const acting = exams.filter((e) => e.title.startsWith('Acting for Camera'));
    expect(acting.map((e) => e.title).sort()).toEqual([
      'Acting for Camera — Advanced Level Test',
      'Acting for Camera — Beginner Level Test',
      'Acting for Camera — Intermediate Level Test',
    ]);
    for (const e of acting) {
      expect(e.canStart, `${e.title}: ${e.blockerMessage ?? ''}`).toBe(true);
      expect(e.passMark).toBe(85);
      expect(e.maxAttempts).toBe(3);
      // The summary is the whole learner surface for an exam, so its key list is
      // the assertion: a draw config added here would be a leak, not a detail.
      expect(Object.keys(e).sort()).toEqual([
        'attemptsUsed', 'blockerCode', 'blockerMessage', 'canStart', 'closesAt', 'description',
        'id', 'kind', 'maxAttempts', 'opensAt', 'passMark', 'timeLimitMinutes', 'title',
      ]);
    }
  });

  it('draws exactly the 20 questions of its own level, and none of the other two', async () => {
    // Fifteen approved L1 decoys sit in the bank for the length of this spec. A
    // draw scoped by stage ALONE would pick from 35 items and cannot miss them;
    // the exam's draw_module_codes is what keeps the paper at 20 of 20 ACT-B.
    // Without the decoys this spec would pass even with the pin removed.
    await seedL1Decoys(15);
    try {
      const beginner = await examFor('Beginner');
      const { started, snapshot } = await sitPaper(beginner.id, 20, `draw-${STAMP}`);

      expect(snapshot).toHaveLength(20);
      expect(new Set(snapshot.map((s) => s.questionItemId)).size).toBe(20);

      const { data: rows } = await db()
        .from('academy_question_items')
        .select('external_code, film_stage, film_module_code')
        .eq('academy_scope', 'film')
        .in('id', snapshot.map((s) => s.questionItemId));
      const drawn = (rows ?? []) as Array<{ external_code: string; film_stage: string; film_module_code: string }>;

      expect(drawn.map((d) => d.external_code).sort()).toEqual(
        Array.from({ length: 20 }, (_, i) => `ACT-B-${String(i + 1).padStart(3, '0')}`));
      for (const d of drawn) {
        expect(d.film_stage).toBe('L1');
        expect(d.film_module_code).toBe('ACT-B');
      }
      // Every stem and every option reached the learner, shuffled but intact.
      expect(started.questions).toHaveLength(20);
      for (const q of started.questions) expect(q.options).toHaveLength(4);
    } finally {
      await removeDecoys();
    }
  }, 120_000);

  it('passes at 17 of 20 and fails at 16, with no key in the learner payload', async () => {
    const intermediate = await examFor('Intermediate');

    const pass = await sitPaper(intermediate.id, 17, `pass-${STAMP}`);
    expect(pass.receipt.earnedPoints).toBe(17);
    expect(pass.receipt.maxPoints).toBe(20);
    expect(pass.receipt.scorePercent).toBe(85);
    expect(pass.receipt.passed).toBe(true);
    expect(pass.receipt.answeredCount).toBe(20);

    const fail = await sitPaper(intermediate.id, 16, `fail-${STAMP}`);
    expect(fail.receipt.earnedPoints).toBe(16);
    expect(fail.receipt.scorePercent).toBe(80);
    expect(fail.receipt.passed).toBe(false);

    const rationale = (await keysFor([fail.snapshot[0].questionItemId])).get(fail.snapshot[0].questionItemId)!.explanation;
    expect(rationale.length).toBeGreaterThan(10);

    for (const [label, payload] of [['start', pass.started], ['view', pass.view], ['fail view', fail.view]] as const) {
      const json = JSON.stringify(payload);
      expect(json, `${label} must not carry the answer key`).not.toMatch(/"correct"/);
      expect(json, `${label} must not carry optionMap`).not.toMatch(/optionMap/);
      expect(json, `${label} must not carry the rationale`).not.toContain(rationale);
    }
  }, 180_000);

  it('reshuffles the retake and stops after the third attempt', async () => {
    const advanced = await examFor('Advanced');

    const first = await sitPaper(advanced.id, 10, `retake-1-${STAMP}`);
    expect(first.receipt.passed).toBe(false);

    const listed = (await listLearnerExams(db(), learner)).find((e) => e.id === advanced.id)!;
    expect(listed.attemptsUsed).toBe(1);
    expect(listed.canStart, 'a failing student must be offered the retake').toBe(true);

    const second = await sitPaper(advanced.id, 17, `retake-2-${STAMP}`);
    expect(second.receipt.passed).toBe(true);

    // Same 20-item pool, so the questions repeat — but each paper's option order
    // is redrawn, which is what the pack's "retake a shuffled assessment" note
    // promises. Compared per question, because the question order is shuffled too.
    const optionOrder = (s: SnapshotItem[]) => new Map(
      s.map((i) => [i.questionItemId, Object.values(i.optionMap).join('')]));
    const before = optionOrder(first.snapshot);
    const after = optionOrder(second.snapshot);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    const unchanged = [...after.entries()].filter(([id, seq]) => before.get(id) === seq);
    expect(unchanged.length).toBeLessThan(after.size);

    await sitPaper(advanced.id, 20, `retake-3-${STAMP}`);
    const spent = (await listLearnerExams(db(), learner)).find((e) => e.id === advanced.id)!;
    expect(spent.attemptsUsed).toBe(3);
    expect(spent.canStart).toBe(false);
    expect(spent.blockerCode).toBe('ATTEMPT_LIMIT_REACHED');
  }, 300_000);
});
