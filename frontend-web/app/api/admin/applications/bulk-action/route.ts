import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { addAuditEvent } from '@/src/server/admin/audit';
import { assertAdminPermission } from '@/src/server/admin/auth';
// ADMIN CONSOLIDATION, slice 5 (see docs/adr/ADR-047): registration/store is
// the in-memory version nothing real ever reads back — the applicant's actual
// application lives in Supabase (registration/supabase-store). This used to
// write a bulk approve/reject/shortlist decision into the memory map only, so
// it looked successful but never touched the applicant's real record.
import { reviewRegistrationApplication } from '@/src/server/registration/supabase-store';
import { reviewApplication as reviewStemApplication } from '@/src/server/stem/persistence';

interface BulkActionPayload {
  target: 'registration' | 'stem';
  applicationIds: string[];
  action: 'approve' | 'reject' | 'shortlist' | 'request_info' | 'disqualify';
  reason: string;
  score?: number;
}

function mapRegistrationStatus(action: BulkActionPayload['action']) {
  switch (action) {
    case 'approve':
      return 'approved';
    case 'reject':
      return 'rejected';
    case 'shortlist':
      return 'shortlisted';
    case 'request_info':
      return 'more_information_requested';
    case 'disqualify':
      return 'disqualified';
    default:
      return 'under_review';
  }
}

function mapStemStatus(action: BulkActionPayload['action']) {
  switch (action) {
    case 'approve':
      return 'approved';
    case 'reject':
      return 'rejected';
    case 'shortlist':
      return 'shortlisted';
    case 'request_info':
      return 'more_information_requested';
    case 'disqualify':
      return 'disqualified';
    default:
      return 'under_review';
  }
}

export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'applications:review');
    const body = (await request.json()) as BulkActionPayload;

    if (!Array.isArray(body?.applicationIds) || body.applicationIds.length === 0) {
      return successResponse({ success: false, error: 'applicationIds are required.' }, 400);
    }
    if (!body.reason || !body.reason.trim()) {
      return successResponse({ success: false, error: 'reason is required for bulk admin actions.' }, 400);
    }

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const applicationId of body.applicationIds) {
      try {
        if (body.target === 'registration') {
          await reviewRegistrationApplication(applicationId, {
            status: mapRegistrationStatus(body.action) as any,
            note: body.reason,
            score: body.score,
          });
        } else {
          await reviewStemApplication(applicationId, {
            status: mapStemStatus(body.action) as any,
            note: body.reason,
            score: body.score,
          });
        }

        addAuditEvent({
          adminUser: identity.actorId || 'admin',
          role: identity.role,
          action: `bulk_${body.action}`,
          module: 'applications',
          entityType: `${body.target}_application`,
          entityId: applicationId,
          reason: body.reason,
          newValue: { action: body.action, target: body.target, score: body.score },
          ipAddress: request.headers.get('x-forwarded-for') || undefined,
        });

        results.push({ id: applicationId, success: true });
      } catch (error) {
        results.push({
          id: applicationId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return successResponse({
      success: true,
      target: body.target,
      action: body.action,
      processed: results.length,
      succeeded: results.filter((entry) => entry.success).length,
      failed: results.filter((entry) => !entry.success).length,
      results,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to process bulk action');
  }
}

