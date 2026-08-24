// Admin: author the curriculum — programmes, modules, lessons and assignments.
//
// The creation logic already existed in src/server/services/academy/lms.ts and in
// the validation parsers; none of it was reachable, so an admin could grade work
// but could not publish a single lesson for anyone to do. This is the wiring.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import {
  createAcademyProgram,
  createAcademyModule,
  createAcademyLesson,
} from '@/src/server/services/academy/lms';
import {
  parseAcademyProgramInput,
  parseAcademyModuleInput,
  parseAcademyLessonInput,
} from '@/lib/validation/academy-lms';

/** The whole authorable tree for the console, in one round trip. */
export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'applications:review');
    const supabase = createAdminClient();

    const [programsRes, modulesRes, lessonsRes, assignmentsRes, batchesRes] = await Promise.all([
      supabase.from('academy_programs').select('id, title, batch_id, is_published').order('created_at'),
      supabase.from('academy_modules').select('id, program_id, title, description, order_index, is_published').order('order_index'),
      supabase.from('academy_lessons').select('id, module_id, title, estimated_minutes, order_index, is_published').order('order_index'),
      supabase.from('academy_assignments').select('id, program_id, batch_id, title, due_date, max_score, status').order('created_at', { ascending: false }),
      supabase.from('academy_batches').select('id, batch_name').order('created_at', { ascending: false }),
    ]);

    const firstError = [programsRes, modulesRes, lessonsRes, assignmentsRes, batchesRes]
      .find((r) => r.error)?.error;
    if (firstError) {
      console.error('[admin/academy/curriculum] load failed', firstError);
      return errorResponse(firstError.message, 500);
    }

    return successResponse({
      success: true,
      programs: programsRes.data ?? [],
      modules: modulesRes.data ?? [],
      lessons: lessonsRes.data ?? [],
      assignments: assignmentsRes.data ?? [],
      batches: batchesRes.data ?? [],
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load curriculum');
  }
}

export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'applications:review');
    const body = (await request.json()) as Record<string, unknown>;
    const kind = String(body.kind ?? '');

    switch (kind) {
      case 'program':
        return successResponse({
          success: true,
          program: await createAcademyProgram(identity.actorId, parseAcademyProgramInput(body)),
        });

      case 'module':
        return successResponse({
          success: true,
          module: await createAcademyModule(identity.actorId, parseAcademyModuleInput(body)),
        });

      case 'lesson':
        return successResponse({
          success: true,
          lesson: await createAcademyLesson(identity.actorId, parseAcademyLessonInput(body)),
        });

      case 'assignment': {
        const title = String(body.title ?? '').trim();
        if (!title) return errorResponse('Assignment title is required', 400);

        // An assignment must reach learners through a programme or a batch. With
        // neither it belongs to nobody and would never appear for anyone.
        const programId = (body.program_id as string) || null;
        const batchId = (body.batch_id as string) || null;
        if (!programId && !batchId) {
          return errorResponse('Choose a programme or a batch for this assignment', 400);
        }

        const maxScore = Number(body.max_score ?? 100);
        if (!Number.isFinite(maxScore) || maxScore <= 0) {
          return errorResponse('Maximum score must be greater than zero', 400);
        }

        const supabase = createAdminClient();
        const { data, error } = await supabase
          .from('academy_assignments')
          .insert({
            title,
            description: String(body.description ?? '') || null,
            program_id: programId,
            batch_id: batchId,
            module_id: (body.module_id as string) || null,
            due_date: (body.due_date as string) || null,
            submission_format: String(body.submission_format ?? 'link'),
            max_score: maxScore,
            rubric: String(body.rubric ?? '') || null,
            // 'published' is the column's own default, so an assignment created
            // by any other path lands in the same state this one does. Publishing
            // straight away is deliberate: a draft is invisible to learners and
            // the console has no workflow to move it out of that state.
            status: 'published',
            created_by: identity.actorId,
          })
          .select('*')
          .single();

        if (error) {
          console.error('[admin/academy/curriculum] assignment insert failed', error);
          return errorResponse(error.message, 500);
        }
        return successResponse({ success: true, assignment: data });
      }

      default:
        return errorResponse('kind must be program, module, lesson or assignment', 400);
    }
  } catch (error) {
    return handleApiError(error, 'Failed to save');
  }
}
