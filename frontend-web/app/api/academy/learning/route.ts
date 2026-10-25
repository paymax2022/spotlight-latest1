// Learner: my curriculum — modules, lessons, and how far I have got.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getDefaultProgramId, resolveLearner } from '@/src/server/services/academy';
import { bestAttemptsByExam, type AttemptRow } from '@/src/server/services/academy/bestAttempt';

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

    const modulesFor = (programId: string) =>
      supabase
        .from('academy_modules')
        .select('id, title, description, order_index, academy_lessons(id, title, description, content_markdown, video_url, resource_url, resource_label, order_index, estimated_minutes, is_required, is_published)')
        .eq('program_id', programId)
        .eq('is_published', true)
        .order('order_index', { ascending: true });

    // Learning opens on payment with no admin release step: when the batch's own
    // programme has nothing published yet, serve the default curriculum rather
    // than an empty "being prepared" page.
    let programId = learner.programId;
    let modulesQuery = await modulesFor(programId);
    if (!modulesQuery.error && (modulesQuery.data ?? []).length === 0) {
      const fallbackId = await getDefaultProgramId(supabase);
      if (fallbackId && fallbackId !== programId) {
        const fallback = await modulesFor(fallbackId);
        if (!fallback.error && (fallback.data ?? []).length > 0) {
          programId = fallbackId;
          modulesQuery = fallback;
        }
      }
    }

    const [progressRes, examsRes, attemptsRes] = await Promise.all([
      supabase
        .from('academy_lesson_progress')
        .select('lesson_id, completed, completed_at')
        .eq('enrollment_id', learner.enrollmentId),
      supabase
        .from('academy_exams')
        .select('id, module_id, title, pass_mark, time_limit_minutes, max_attempts')
        .eq('program_id', programId)
        .not('module_id', 'is', null),
      supabase
        .from('academy_exam_attempts')
        .select('exam_id, status, score, total_points, percentage, passed')
        .eq('enrollment_id', learner.enrollmentId),
    ]);

    const modulesRes = modulesQuery;
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

    // Unpublished lessons are filtered here rather than in the query: the embedded
    // select cannot filter the child rows, so leaving it to Postgres would leak
    // draft lessons into a learner's curriculum.
    const modules = (modulesRes.data ?? []).map((m, idx) => {
      const mod = m as {
        id: string; title: string; description: string | null; order_index: number | null;
        academy_lessons?: Array<Record<string, unknown>>;
      };
      const lessons = (mod.academy_lessons ?? [])
        .filter((l) => l.is_published !== false)
        .sort((a, b) => Number(a.order_index ?? 0) - Number(b.order_index ?? 0))
        .map((l): Record<string, unknown> & { completed: boolean; completed_at: string | null } => ({
          ...l,
          completed: done.get(l.id as string)?.completed === true,
          completed_at: (done.get(l.id as string)?.completed_at as string | null | undefined) ?? null,
        }));

      // Get quiz for this module
      const exam = examsByModuleId.get(mod.id);
      const attempt = exam ? attemptsByExamId.get(exam.id) : null;
      const quizPassed = attempt && attempt.percentage >= exam!.pass_mark;

      // Module is locked if the previous module's quiz was not passed at 85%
      const previousModuleQuizPassed = idx === 0 ? true : (() => {
        const prevModules = (modulesRes.data ?? []) as Array<{ id: string }>;
        const prevMod = prevModules[idx - 1];
        const prevExam = examsByModuleId.get(prevMod.id);
        if (!prevExam) return true; // no quiz on previous module, not locked
        const prevAttempt = attemptsByExamId.get(prevExam.id);
        return !!prevAttempt && prevAttempt.percentage >= prevExam.pass_mark;
      })();
      const isLocked = !previousModuleQuizPassed;

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
            scorePercent: Math.round(attempt.percentage),
            passed: quizPassed,
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
