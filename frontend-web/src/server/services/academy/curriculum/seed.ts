// Writes an authored pathway into the database.
//
// Idempotent by natural key, because seeding is something people re-run: modules
// by (program_id, title), lessons by (module_id, title), exams by (program_id,
// title), questions by (exam_id, order_index), assignments by (program_id, title).
// Re-running updates content in place instead of producing a second copy of the
// curriculum.
import { createAdminClient } from '@/lib/supabase/server';
import type { Pathway, Quiz } from './types';

type Db = ReturnType<typeof createAdminClient>;

export interface SeedReport {
  programId: string;
  modules: { created: number; updated: number };
  lessons: { created: number; updated: number };
  quizzes: { created: number; updated: number };
  questions: { created: number; updated: number };
  assignments: { created: number; updated: number };
  warnings: string[];
}

/**
 * The grader compares `correct_answer` against the option strings verbatim
 * (trimmed and sorted). A correct answer that is not among the options can never
 * be selected, so the question would be unanswerable and silently unscoreable.
 * Caught here rather than discovered by a learner mid-assessment.
 */
export function validatePathway(pathway: Pathway): string[] {
  const problems: string[] = [];
  const seenModuleTitles = new Set<string>();

  for (const tier of pathway.tiers) {
    const quizzes: Array<{ where: string; quiz: Quiz }> = [];
    for (const mod of tier.modules) {
      if (seenModuleTitles.has(mod.title)) {
        // Modules are keyed on title, so a duplicate would overwrite its twin.
        problems.push(`Duplicate module title: "${mod.title}"`);
      }
      seenModuleTitles.add(mod.title);
      quizzes.push({ where: mod.title, quiz: mod.quiz });
    }
    if (tier.assessment) quizzes.push({ where: `Tier ${tier.level} assessment`, quiz: tier.assessment });

    for (const { where, quiz } of quizzes) {
      if (quiz.questions.length === 0) problems.push(`${where}: quiz has no questions`);
      quiz.questions.forEach((q, i) => {
        if (q.correct.length === 0) {
          problems.push(`${where} Q${i + 1}: no correct answer`);
        }
        for (const c of q.correct) {
          if (!q.options.includes(c)) {
            problems.push(`${where} Q${i + 1}: correct answer "${c}" is not one of the options`);
          }
        }
        if (q.type === 'single_choice' && q.correct.length !== 1) {
          problems.push(`${where} Q${i + 1}: single_choice must have exactly one correct answer`);
        }
        if (q.type === 'true_false' && (q.options.length !== 2 || q.correct.length !== 1)) {
          problems.push(`${where} Q${i + 1}: true_false must have two options and one correct answer`);
        }
        if (q.points <= 0) problems.push(`${where} Q${i + 1}: points must be greater than zero`);
      });
      if (quiz.passMark < 0 || quiz.passMark > 100) problems.push(`${where}: pass mark out of range`);
      if (quiz.timeLimitMinutes <= 0) problems.push(`${where}: time limit must be positive`);
      if (quiz.maxAttempts <= 0) problems.push(`${where}: max attempts must be positive`);
    }
  }
  return problems;
}

/**
 * `created_by` is a uuid column, but assertAdminPermission returns the literal
 * 'system' for the server-to-server API-key path. Writing that straight through
 * fails the insert with an opaque uuid syntax error, so a non-uuid actor is
 * recorded as no actor rather than breaking the seed.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asActorId = (id: string): string | null => (UUID_RE.test(id) ? id : null);

/** Upsert-by-natural-key helper. Returns the row id and whether it was new. */
async function upsertRow(
  supabase: Db,
  table: string,
  match: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<{ id: string; created: boolean }> {
  let query = supabase.from(table).select('id');
  for (const [k, v] of Object.entries(match)) {
    query = v === null ? query.is(k, null) : query.eq(k, v as never);
  }
  const { data: existing, error: findErr } = await query.limit(1).maybeSingle();
  if (findErr) throw new Error(`${table}: lookup failed — ${findErr.message}`);

  if (existing) {
    const id = (existing as { id: string }).id;
    const { error } = await supabase.from(table).update(payload).eq('id', id);
    if (error) throw new Error(`${table}: update failed — ${error.message}`);
    return { id, created: false };
  }

  const { data, error } = await supabase
    .from(table)
    .insert({ ...match, ...payload })
    .select('id')
    .single();
  if (error || !data) throw new Error(`${table}: insert failed — ${error?.message}`);
  return { id: (data as { id: string }).id, created: true };
}

export async function seedPathway(
  supabase: Db,
  programId: string,
  batchId: string | null,
  pathway: Pathway,
  adminId: string,
): Promise<SeedReport> {
  const problems = validatePathway(pathway);
  if (problems.length > 0) {
    throw new Error(`Pathway is invalid:\n- ${problems.join('\n- ')}`);
  }

  const report: SeedReport = {
    programId,
    modules: { created: 0, updated: 0 },
    lessons: { created: 0, updated: 0 },
    quizzes: { created: 0, updated: 0 },
    questions: { created: 0, updated: 0 },
    assignments: { created: 0, updated: 0 },
    warnings: [],
  };

  const bump = (b: { created: number; updated: number }, created: boolean) =>
    created ? b.created++ : b.updated++;

  // Ordering is continuous across the whole pathway, not per tier, so the learner
  // sees one sequence rather than five restarts.
  let moduleIndex = 0;

  const writeQuiz = async (quiz: Quiz, moduleId: string | null) => {
    const { id: examId, created } = await upsertRow(
      supabase,
      'academy_exams',
      { program_id: programId, title: quiz.title },
      {
        module_id: moduleId,
        description: quiz.description,
        pass_mark: quiz.passMark,
        time_limit_minutes: quiz.timeLimitMinutes,
        max_attempts: quiz.maxAttempts,
        is_published: true,
        created_by: asActorId(adminId),
      },
    );
    bump(report.quizzes, created);

    for (let qi = 0; qi < quiz.questions.length; qi++) {
      const q = quiz.questions[qi];
      const res = await upsertRow(
        supabase,
        'academy_exam_questions',
        { exam_id: examId, order_index: qi },
        {
          question_text: q.text,
          question_type: q.type,
          options: q.options,
          correct_answer: q.correct,
          points: q.points,
          explanation: q.explanation,
          is_active: true,
        },
      );
      bump(report.questions, res.created);
    }
  };

  for (const tier of pathway.tiers) {
    for (const mod of tier.modules) {
      const { id: moduleId, created: modCreated } = await upsertRow(
        supabase,
        'academy_modules',
        { program_id: programId, title: mod.title },
        {
          description: `Tier ${tier.level} · ${tier.name} — ${mod.description}`,
          order_index: moduleIndex,
          is_published: true,
        },
      );
      bump(report.modules, modCreated);

      for (let li = 0; li < mod.lessons.length; li++) {
        const lesson = mod.lessons[li];
        const res = await upsertRow(
          supabase,
          'academy_lessons',
          { module_id: moduleId, title: lesson.title },
          {
            description: lesson.description,
            content_markdown: lesson.content,
            // These columns are NOT NULL with an empty-string default, so an
            // explicit null violates the constraint where an absent value would
            // not. Empty string is the schema's own way of saying "none".
            video_url: lesson.videoUrl || '',
            resource_url: lesson.resourceUrl || '',
            resource_label: lesson.resourceLabel || '',
            order_index: li,
            estimated_minutes: lesson.minutes,
            is_required: lesson.required !== false,
            is_published: true,
          },
        );
        bump(report.lessons, res.created);
        if (!lesson.videoUrl) {
          report.warnings.push(`No video for "${mod.title}" → "${lesson.title}"`);
        }
      }

      await writeQuiz(mod.quiz, moduleId);

      if (mod.assignment) {
        const due = new Date();
        due.setDate(due.getDate() + mod.assignment.dueInDays);
        const res = await upsertRow(
          supabase,
          'academy_assignments',
          { program_id: programId, title: mod.assignment.title },
          {
            description: mod.assignment.brief,
            rubric: mod.assignment.rubric,
            max_score: mod.assignment.maxScore,
            due_date: due.toISOString(),
            module_id: moduleId,
            batch_id: batchId,
            submission_format: 'link',
            status: 'published',
            created_by: asActorId(adminId),
          },
        );
        bump(report.assignments, res.created);
      }

      moduleIndex++;
    }

    // A tier assessment spans several modules, so it carries no module_id.
    if (tier.assessment) await writeQuiz(tier.assessment, null);
  }

  return report;
}
