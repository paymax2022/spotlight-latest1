import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { addAuditEvent } from '@/src/server/admin/audit';
import { type AdminRole } from '@/src/server/admin/rbac';

const roles: Array<{ role: AdminRole; users: number; description: string }> = [
  { role: 'super_admin', users: 2, description: 'Full platform control and governance overrides.' },
  { role: 'program_manager', users: 4, description: 'Program setup, lifecycle and participant funnels.' },
  { role: 'contest_manager', users: 5, description: 'Contest configuration, rounds and publication.' },
  { role: 'voting_manager', users: 3, description: 'Voting operations, anomaly reviews and result lock.' },
  { role: 'finance_admin', users: 2, description: 'Revenue, reconciliation and refund control.' },
  { role: 'content_manager', users: 3, description: 'CMS and communication assets management.' },
  { role: 'media_manager', users: 2, description: 'Media uploads, galleries and visual publishing.' },
  { role: 'sponsor_manager', users: 2, description: 'Sponsor lifecycle and deliverable tracking.' },
  { role: 'judge', users: 11, description: 'Assigned scorecard access only.' },
  { role: 'reviewer', users: 6, description: 'Application review and recommendation workflows.' },
  { role: 'event_manager', users: 4, description: 'Event and venue coordination operations.' },
  { role: 'support_agent', users: 6, description: 'Applicant support and communication triage.' },
  { role: 'auditor', users: 2, description: 'Audit and compliance report access.' },
  { role: 'executive_readonly', users: 3, description: 'Read-only executive and board-level visibility.' },
];

export async function GET(request: Request) {
  try {
    const identity = assertAdminPermission(request, 'roles:manage');

    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'roles_matrix_view',
      module: 'users_roles',
      entityType: 'role',
      reason: 'Viewed users and roles matrix',
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });

    return successResponse({
      success: true,
      roles,
      usersSummary: {
        totalAdminUsers: roles.reduce((sum, entry) => sum + entry.users, 0),
        privilegedUsers: roles.filter((entry) => ['super_admin', 'finance_admin'].includes(entry.role)).reduce((sum, entry) => sum + entry.users, 0),
        pendingInvites: 4,
      },
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load users and roles');
  }
}
