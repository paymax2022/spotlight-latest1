// Admin: install the authored Film Craft Pathway into a programme.
//
// Idempotent — safe to re-run. Re-running updates the curriculum in place rather
// than creating a second copy, so correcting a typo in the source data and
// re-seeding is the intended workflow.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { FILM_PATHWAY } from '@/src/server/services/academy/curriculum';
import { seedPathway, validatePathway } from '@/src/server/services/academy/curriculum/seed';

/** Dry run: report what would be written, and any content problems. */
export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'applications:review');
    const problems = validatePathway(FILM_PATHWAY);

    const tiers = FILM_PATHWAY.tiers.map((t) => ({
      level: t.level,
      name: t.name,
      summary: t.summary,
      modules: t.modules.map((m) => ({
        title: m.title,
        lessons: m.lessons.length,
        questions: m.quiz.questions.length,
        hasAssignment: Boolean(m.assignment),
        videosMissing: m.lessons.filter((l) => !l.videoUrl).length,
      })),
      hasAssessment: Boolean(t.assessment),
    }));

    const moduleCount = FILM_PATHWAY.tiers.reduce((n, t) => n + t.modules.length, 0);
    const lessonCount = FILM_PATHWAY.tiers.reduce(
      (n, t) => n + t.modules.reduce((m, mod) => m + mod.lessons.length, 0), 0,
    );

    return successResponse({
      success: true,
      valid: problems.length === 0,
      problems,
      pathway: { name: FILM_PATHWAY.name, summary: FILM_PATHWAY.summary, moduleCount, lessonCount, tiers },
    });
  } catch (error) {
    return handleApiError(error, 'Failed to inspect the pathway');
  }
}

export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'applications:review');
    const body = (await request.json().catch(() => ({}))) as { programId?: string };
    if (!body.programId) return errorResponse('programId is required', 400);

    const supabase = createAdminClient();

    const { data: program } = await supabase
      .from('academy_programs')
      .select('id, title, batch_id')
      .eq('id', body.programId)
      .maybeSingle();

    if (!program) return errorResponse('Programme not found', 404);
    const prog = program as { id: string; title: string; batch_id: string | null };

    const report = await seedPathway(
      supabase,
      prog.id,
      prog.batch_id,
      FILM_PATHWAY,
      identity.actorId,
    );

    return successResponse({ success: true, programme: prog.title, report });
  } catch (error) {
    return handleApiError(error, 'Failed to install the pathway');
  }
}
