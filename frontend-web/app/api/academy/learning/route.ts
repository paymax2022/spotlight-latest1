// Learner: my curriculum — modules, lessons, and how far I have got.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy';
import { bestAttemptsByExam, type AttemptRow } from '@/src/server/services/academy/bestAttempt';
import { moduleLockStates, quizPassed } from '@/src/server/services/academy/moduleGate';

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    const learner = await resolveLearner(supabase, user.id);
    if (!learner.ok) {
      // Not an error — the applicant simply has not reached this stage. The client
      // renders the reason, so a 200 with a locked payload beats a 403 here.
      return successResponse({ success: true, locked: true, reason: learner.reason, modules: [] });
    }

    if (!learner.programId) {
      return successResponse({
        success: true, locked: true, reason: 'no_curriculum', modules: [],
        enrollmentId: learner.enrollmentId,
      });
    }

    const [modulesRes, progressRes, examsRes, attemptsRes] = await Promise.all([
      supabase
        .from('academy_modules')
        .select('id, title, description, order_index, academy_lessons(id, title, description, content_markdown, video_url, resource_url, resource_label, order_index, estimated_minutes, is_required, is_published)')
        .eq('program_id', learner.programId)
        .eq('is_published', true)
        .order('order_index', { ascending: true }),
      supabase
        .from('academy_lesson_progress')
        .select('lesson_id, completed, completed_at')
        .eq('enrollment_id', learner.enrollmentId),
      supabase
        .from('academy_exams')
        .select('id, module_id, title, pass_mark, time_limit_minutes, max_attempts')
        .eq('program_id', learner.programId)
        .not('module_id', 'is', null),
      supabase
        .from('academy_exam_attempts')
        .select('exam_id, status, score, total_points, percentage, passed')
        .eq('enrollment_id', learner.enrollmentId),
    ]);

    if (modulesRes.error) {
      console.error('[academy/learning] modules failed', modulesRes.error);
      return errorResponse('Failed to load your curriculum', 500);
    }
    if (progressRes.error) {
      console.error('[academy/learning] progress failed', progressRes.error);
      return errorResponse('Failed to load your progress', 500);
    }
    if (examsRes.error) {
      console.error('[academy/learning] exams failed', examsRes.error);
      return errorResponse('Failed to load module quizzes', 500);
    }
    if (attemptsRes.error) {
      console.error('[academy/learning] attempts failed', attemptsRes.error);
      return errorResponse('Failed to load quiz attempts', 500);
    }

    const done = new Map(
      (progressRes.data ?? []).map((p) => {
        const row = p as { lesson_id: string; completed: boolean; completed_at: string | null };
        return [row.lesson_id, row];
      }),
    );

    // Build exam and attempt maps for quick lookup
    const examsByModuleId = new Map(
      (examsRes.data ?? []).map((e) => {
        const exam = e as { id: string; module_id: string; title: string; pass_mark: number; time_limit_minutes: number; max_attempts: number };
        return [exam.module_id, exam];
      }),
    );

    const attemptsByExamId = bestAttemptsByExam((attemptsRes.data ?? []) as AttemptRow[]);
    const lockStates = moduleLockStates(
      (modulesRes.data ?? []).map((m) => (m as { id: string }).id),
      examsByModuleId,
      attemptsByExamId,
    );

    // Unpublished lessons are filtered here rather than in the query: the embedded
    // select cannot filter the child rows, so leaving it to Postgres would leak
    // draft lessons into a learner's curriculum.
    const modules = (modulesRes.data ?? []).map((m, idx) => {
      const mod = m as {
        id: string; title: string; description: string | null; order_index: number | null;
        academy_lessons?: Array<Record<string, unknown>>;
      };
      // Module is locked until the previous module's quiz is passed. A locked
      // module shows its outline only — no lesson body, video or resources.
      const isLocked = lockStates[idx];
      const lessons = (mod.academy_lessons ?? [])
        .filter((l) => l.is_published !== false)
        .sort((a, b) => Number(a.order_index ?? 0) - Number(b.order_index ?? 0))
        .map((l): Record<string, unknown> & { completed: boolean; completed_at: string | null } => ({
          ...(isLocked ? lessonOutline(l) : l),
          completed: done.get(l.id as string)?.completed === true,
          completed_at: (done.get(l.id as string)?.completed_at as string | null | undefined) ?? null,
        }));

      // Get quiz for this module
      const exam = examsByModuleId.get(mod.id);
      const attempt = exam ? attemptsByExamId.get(exam.id) : null;
      const quizIsPassed = exam ? quizPassed(exam, attempt) : false;

      const result: Record<string, unknown> & { lessons: typeof lessons } = {
        id: mod.id,
        title: mod.title,
        description: mod.description,
        order_index: mod.order_index,
        lessons,
        completedCount: lessons.filter((l) => l.completed).length,
        isLocked,
      };

      if (exam) {
        result.quiz = {
          id: exam.id,
          title: exam.title,
          passMark: exam.pass_mark,
          timeLimitMinutes: exam.time_limit_minutes,
          maxAttempts: exam.max_attempts,
          canStart: !isLocked,
          lastResult: attempt ? {
            // Floored from points so a just-under score never displays as the pass mark.
            scorePercent: attempt.totalPoints > 0 ? Math.floor((attempt.score * 100) / attempt.totalPoints) : 0,
            passed: quizIsPassed,
            earnedPoints: attempt.score,
            maxPoints: attempt.totalPoints,
          } : null,
        };
      }

      return result;
    });

    const allLessons = modules.flatMap((m) => m.lessons as Array<{ completed: boolean }>);
    return successResponse({
      success: true,
      locked: false,
      enrollmentId: learner.enrollmentId,
      modules,
      totalLessons: allLessons.length,
      completedLessons: allLessons.filter((l) => l.completed).length,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to load curriculum');
  }
}

/** What a learner may see of a lesson in a locked module: its outline, not its teaching content. */
function lessonOutline(l: Record<string, unknown>): Record<string, unknown> {
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    order_index: l.order_index,
    estimated_minutes: l.estimated_minutes,
    is_required: l.is_required,
    is_published: l.is_published,
    content_markdown: '',
    video_url: '',
    resource_url: '',
    resource_label: '',
  };
}
