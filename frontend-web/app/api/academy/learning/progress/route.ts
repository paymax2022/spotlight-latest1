// Learner: mark a lesson complete (or undo it).
import { NextResponse } from 'next/server';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy';
import { ModuleGateUnavailableError, moduleLockedFor } from '@/src/server/services/academy/moduleGate';

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json().catch(() => null)) as { lessonId?: string; completed?: boolean };
    if (!body) return errorResponse('Invalid JSON body', 400);
    if (!body.lessonId) return errorResponse('lessonId is required', 400);

    const supabase = createAdminClient();
    const learner = await resolveLearner(supabase, user.id);
    if (!learner.ok) return errorResponse('You are not enrolled yet', 403);

    // The lesson must belong to THIS learner's programme. Without this a learner
    // could mark progress against any lesson id in the database.
    const { data: lesson } = await supabase
      .from('academy_lessons')
      .select('id, module_id, academy_modules!inner(program_id)')
      .eq('id', body.lessonId)
      .maybeSingle();

    const row = lesson as { module_id?: string; academy_modules?: { program_id?: string } } | null;
    const owningProgram = row?.academy_modules?.program_id;
    if (!row || !row.module_id || !learner.programId || owningProgram !== learner.programId) {
      return errorResponse('Lesson not found in your curriculum', 404);
    }

    // A locked module shows only its outline in /api/academy/learning, so its
    // lessons cannot be completed either — same rule (moduleGate.ts), enforced
    // here so a direct call cannot skip a module. A failed gate read refuses.
    const lock = await moduleLockedFor(supabase, learner.programId, row.module_id, learner.enrollmentId);
    if (lock === 'unavailable') return errorResponse('Lesson not found in your curriculum', 404);
    if (lock === 'locked') {
      return NextResponse.json(
        { success: false, code: 'MODULE_LOCKED', error: 'Pass the previous module quiz first to unlock this lesson.' },
        { status: 403 },
      );
    }

    const completed = body.completed !== false;

    // UNIQUE(enrollment_id, lesson_id) makes this idempotent — tapping twice is a
    // no-op rather than a duplicate row.
    const { error } = await supabase
      .from('academy_lesson_progress')
      .upsert(
        {
          enrollment_id: learner.enrollmentId,
          lesson_id: body.lessonId,
          completed,
          completed_at: completed ? new Date().toISOString() : null,
        },
        { onConflict: 'enrollment_id,lesson_id' },
      );

    if (error) {
      console.error('[academy/learning/progress] upsert failed', error);
      return errorResponse('Could not save your progress', 500);
    }

    return successResponse({ success: true, lessonId: body.lessonId, completed });
  } catch (error) {
    if (error instanceof ModuleGateUnavailableError) {
      return NextResponse.json(
        { success: false, code: 'MODULE_GATE_UNAVAILABLE', error: 'Could not check your module progress. Please try again.' },
        { status: 500 },
      );
    }
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to save progress');
  }
}
