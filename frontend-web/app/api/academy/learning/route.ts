// Learner: my curriculum — modules, lessons, and how far I have got.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy/learner';

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

    const [modulesRes, progressRes] = await Promise.all([
      supabase
        .from('academy_modules')
        .select('id, title, description, order_index, academy_lessons(id, title, description, video_url, resource_url, resource_label, order_index, estimated_minutes, is_required, is_published)')
        .eq('program_id', learner.programId)
        .eq('is_published', true)
        .order('order_index', { ascending: true }),
      supabase
        .from('academy_lesson_progress')
        .select('lesson_id, completed, completed_at')
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

    const done = new Map(
      (progressRes.data ?? []).map((p) => {
        const row = p as { lesson_id: string; completed: boolean; completed_at: string | null };
        return [row.lesson_id, row];
      }),
    );

    // Unpublished lessons are filtered here rather than in the query: the embedded
    // select cannot filter the child rows, so leaving it to Postgres would leak
    // draft lessons into a learner's curriculum.
    const modules = (modulesRes.data ?? []).map((m) => {
      const mod = m as {
        id: string; title: string; description: string | null; order_index: number | null;
        academy_lessons?: Array<Record<string, unknown>>;
      };
      const lessons = (mod.academy_lessons ?? [])
        .filter((l) => l.is_published !== false)
        .sort((a, b) => Number(a.order_index ?? 0) - Number(b.order_index ?? 0))
        .map((l) => ({
          ...l,
          completed: done.get(l.id as string)?.completed === true,
          completed_at: done.get(l.id as string)?.completed_at ?? null,
        }));
      return {
        id: mod.id,
        title: mod.title,
        description: mod.description,
        order_index: mod.order_index,
        lessons,
        completedCount: lessons.filter((l) => l.completed).length,
      };
    });

    const allLessons = modules.flatMap((m) => m.lessons);
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
