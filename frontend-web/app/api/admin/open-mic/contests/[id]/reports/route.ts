import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicReadAdmin } from '@/src/server/openmic/auth';
import {
  getContestById,
  listApplications,
  listBeatDownloads,
  listFraudAlerts,
  listPaymentEvents,
  listSubmissions,
} from '@/src/server/openmic/persistence';

export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    assertOpenMicReadAdmin(request);
    const [contest, applications, downloads, submissions, payments, fraudAlerts] = await Promise.all([
      getContestById(context.params.id),
      listApplications({ contestId: context.params.id }),
      listBeatDownloads(context.params.id),
      listSubmissions({ contestId: context.params.id }),
      listPaymentEvents(context.params.id),
      listFraudAlerts(context.params.id),
    ]);
    const totalVotes = submissions.reduce((sum, row) => sum + row.voteCount, 0);
    const approvedSongs = submissions.filter((row) =>
      ['approved', 'published_for_voting', 'finalist', 'winner'].includes(row.status)
    ).length;
    const finalists = submissions.filter((row) => row.isFinalist).length;
    const winners = submissions.filter((row) => row.isWinner).length;
    const votingRevenue = payments
      .filter((row) => row.eventType === 'vote_payment' && row.paymentStatus === 'successful')
      .reduce((sum, row) => sum + row.amountNgn, 0);
    const entryRevenue = payments
      .filter((row) => row.eventType === 'entry_fee' && row.paymentStatus === 'successful')
      .reduce((sum, row) => sum + row.amountNgn, 0);

    return successResponse({
      success: true,
      metrics: {
        totalApplicants: applications.length,
        approvedSongs,
        beatDownloads: downloads.length,
        totalVotes,
        votingRevenue,
        entryRevenue,
        totalRevenue: votingRevenue + entryRevenue,
        finalists,
        winners,
        suspiciousVotingAlerts: fraudAlerts.length,
        failedPayments: payments.filter((row) => row.paymentStatus === 'failed').length,
      },
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load reports');
  }
}
