import { successResponse, handleApiError } from '@/src/lib/api/responses';
// ADMIN CONSOLIDATION, slice 5 (see docs/adr/ADR-047): registration/store is
// the in-memory version nothing real ever writes to — real applications live
// in Supabase (registration/supabase-store), same fix as the openmic import
// above. listRegistrationApplications here is async and its filter argument
// is required (not optional), unlike the memory version.
import { listRegistrationApplications } from '@/src/server/registration/supabase-store';
// ADMIN CONSOLIDATION, slice 5 (see docs/adr/ADR-047): the in-memory openmic/store
// import is never written to by any real flow; every open-mic admin page and API
// route reads openmic/persistence (Supabase-backed) instead. persistence.ts is
// async where store.ts was sync — calls below are awaited accordingly.
import { listContests, listSubmissions, listFraudAlerts, listPaymentEvents } from '@/src/server/openmic/persistence';
import { listStemAdminContests, listStemApplications } from '@/src/server/stem/store';
import { addAuditEvent } from '@/src/server/admin/audit';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';

// KPI keys with no real data source behind them yet. Each is set to null in the
// payload rather than a plausible-looking number, and listed here so a consumer
// can render "—" / "Coming soon" instead of trusting a fake figure. Investigated
// while fixing the openmic store mismatch (slice 5):
//   activeAuditions, activeBootcampParticipants, publishedContent — no backing
//     entity exists anywhere in the codebase, only field labels in registration
//     forms that happen to use those words.
//   upcomingEvents — src/server/admin/events.ts is itself only an in-memory
//     store seeded with one fake sample event; there is no persistence layer to
//     read from, so wiring it would just swap one fake number for another.
//   evictionCandidates — reality-show has real eviction data, but that module
//     had uncommitted work in progress elsewhere in the tree while this was
//     written; deferred rather than building against a moving target.
//   activeSponsors — real per-contest data exists at
//     services/competition/sponsor.service.ts#listActivePlacements, but it's
//     scoped per competition with no aggregate query; wiring it needs an
//     explicit decision on how to roll N contests' sponsor lists into one count.
//   freeVotesUsed — voting config tracks a freeVotesPerDay *policy*, not a
//     free/paid breakdown of votes actually cast; no source to sum.
//   trends.registrationGrowth, trends.voteTrend — need a real time-series
//     aggregation (group by day/week) that nothing here currently computes.
const PLACEHOLDER_KPIS = [
  'activeAuditions',
  'upcomingEvents',
  'activeBootcampParticipants',
  'evictionCandidates',
  'activeSponsors',
  'publishedContent',
  'freeVotesUsed',
] as const;
const PLACEHOLDER_TRENDS = ['registrationGrowth', 'voteTrend'] as const;

export async function GET(req: Request) {
  try {
    const identity = await assertAdminPermission(req, 'dashboard:view');

    const registrations = await listRegistrationApplications({});
    const openMicContests = await listContests({ includeNonPublic: true });
    const openMicSubmissions = await listSubmissions();
    const stemContests = listStemAdminContests();
    const stemApplications = listStemApplications();
    // Single global fetch, reused below for revenue, the per-contest revenue
    // trend, and the payment-reconciliation alert — all three read the same
    // rows rather than issuing three separate queries.
    const openMicPaymentEvents = await listPaymentEvents();
    const openFraudAlerts = (await listFraudAlerts()).filter((a) => a.status === 'open');

    const totalApplicants = registrations.length + stemApplications.length;
    const pendingApplications =
      registrations.filter((r) => r.status === 'draft' || r.status === 'under_review').length +
      stemApplications.filter((a) => a.status === 'submitted' || a.status === 'under_review').length;

    const approvedApplications =
      registrations.filter((r) => r.status === 'approved' || r.status === 'shortlisted').length +
      stemApplications.filter((a) => a.status === 'approved' || a.status === 'shortlisted').length;

    const rejectedApplications =
      registrations.filter((r) => r.status === 'rejected').length +
      stemApplications.filter((a) => a.status === 'rejected').length;

    const openMicActiveContests = openMicContests.filter((c) =>
      ['published', 'registration_open', 'submission_open', 'voting_live'].includes(c.status));
    const stemActiveContests = stemContests.filter((c) =>
      ['published', 'open_for_registration', 'under_review', 'voting_live'].includes(c.status));
    const activeContests = openMicActiveContests.length + stemActiveContests.length;

    // "Programs" = distinct program categories with something active right now.
    // Open Mic and STEM each count as one program if either has an active
    // contest. The remaining catalog programs (reality-tv-show, sme-pitch-contest,
    // film-academy, …) don't have their own contest stores — they live as
    // registration applications — so a program counts as active there if it has
    // at least one application that isn't rejected.
    const NON_TERMINAL_REGISTRATION_STATUSES = new Set([
      'draft', 'submitted', 'under_review', 'shortlisted', 'callback_invited', 'approved',
    ]);
    const activeRegistrationPrograms = new Set(
      registrations
        .filter((r) => NON_TERMINAL_REGISTRATION_STATUSES.has(r.status))
        .map((r) => r.contestSlug),
    );
    const activePrograms =
      (openMicActiveContests.length > 0 ? 1 : 0) +
      (stemActiveContests.length > 0 ? 1 : 0) +
      activeRegistrationPrograms.size;

    // Real vote count: each submission's voteCount is Supabase's
    // public_vote_count column, already loaded above — no extra query.
    const totalVotes = openMicSubmissions.reduce((sum, s) => sum + (s.voteCount || 0), 0);

    // Real revenue: sum of successful vote-purchase payment events. Replaces a
    // previous formula that multiplied real votePrice by a fabricated
    // "mockVolume" constant — that was never a real number.
    const paidVoteRevenue = openMicPaymentEvents
      .filter((p) => p.eventType === 'vote_payment' && p.paymentStatus === 'successful')
      .reduce((sum, p) => sum + (p.amountNgn || 0), 0);

    // Real per-contest revenue trend: sum successful entry-fee payments per
    // contest, from the same payment events already fetched above. Replaces a
    // previous version that multiplied each contest's fee by a flat, made-up
    // ×100 registration-count assumption.
    const entryFeeRevenueByContest = new Map<string, number>();
    for (const p of openMicPaymentEvents) {
      if (p.eventType !== 'entry_fee' || p.paymentStatus !== 'successful') continue;
      entryFeeRevenueByContest.set(p.contestId, (entryFeeRevenueByContest.get(p.contestId) || 0) + (p.amountNgn || 0));
    }
    const revenueByContest = openMicContests
      .slice(0, 5)
      .map((c) => ({ contest: c.title, revenue: entryFeeRevenueByContest.get(c.id) || 0 }));

    // Real alerts, generated from the data already on hand rather than three
    // fixed strings. Only the conditions that are actually true produce a line.
    const now = Date.now();
    const draftContestsPastStart = openMicContests.filter(
      (c) => c.status === 'draft' && c.registrationStartAt && new Date(c.registrationStartAt).getTime() < now,
    ).length;
    const pendingPaymentEvents = openMicPaymentEvents.filter((p) => p.paymentStatus === 'pending').length;

    const alerts: string[] = [];
    if (draftContestsPastStart > 0) {
      alerts.push(`${draftContestsPastStart} open mic contest(s) are in draft with a registration start date in the past.`);
    }
    if (openFraudAlerts.length > 0) {
      alerts.push(`${openFraudAlerts.length} open fraud alert(s) need review.`);
    }
    if (pendingPaymentEvents > 0) {
      alerts.push(`${pendingPaymentEvents} payment event(s) are pending reconciliation.`);
    }

    // Real registered-user count — a direct count against user_profiles rather
    // than "applicants padded up to a floor of 700".
    let totalRegisteredUsers: number | null = null;
    try {
      const supabase = createAdminClient();
      const { count, error } = await supabase.from('user_profiles').select('id', { count: 'exact', head: true });
      if (!error && typeof count === 'number') totalRegisteredUsers = count;
    } catch {
      // Leave null (surfaced via placeholders below) rather than guess.
    }

    const placeholderKpis: string[] = [...PLACEHOLDER_KPIS];
    if (totalRegisteredUsers === null) placeholderKpis.push('totalRegisteredUsers');

    const payload = {
      kpis: {
        totalRegisteredUsers,
        totalApplicants,
        totalContestants: approvedApplications,
        activeContests,
        activePrograms,
        totalVotes,
        paidVotesRevenueNgn: paidVoteRevenue,
        freeVotesUsed: null,
        pendingApplications,
        approvedApplications,
        rejectedApplications,
        activeAuditions: null,
        upcomingEvents: null,
        activeBootcampParticipants: null,
        evictionCandidates: null,
        activeSponsors: null,
        publishedContent: null,
        recentPaymentActivity: registrations.filter((r) => String(r.formData['payment.paymentStatus'] || '') === 'paid').length,
        systemAlerts: alerts.length,
      },
      trends: {
        registrationGrowth: null,
        voteTrend: null,
        revenueByContest,
        applicationsByProgram: [
          { program: 'Open Mic', value: openMicSubmissions.length },
          { program: 'STEM', value: stemApplications.length },
          { program: 'Reality TV', value: registrations.filter((r) => r.contestSlug === 'reality-tv-show').length },
          { program: 'SME Pitch', value: registrations.filter((r) => r.contestSlug === 'sme-pitch-contest').length },
        ],
      },
      alerts,
      placeholders: {
        kpis: placeholderKpis,
        trends: PLACEHOLDER_TRENDS,
      },
    };

    addAuditEvent({
      adminUser: identity.actorId || 'system-admin',
      role: identity.role,
      action: 'dashboard_read',
      module: 'dashboard',
      entityType: 'dashboard',
      reason: 'Dashboard KPI access',
      ipAddress: req.headers.get('x-forwarded-for') || undefined,
    });

    return successResponse(payload);
  } catch (error) {
    return handleApiError(error, 'Failed to load admin dashboard');
  }
}
