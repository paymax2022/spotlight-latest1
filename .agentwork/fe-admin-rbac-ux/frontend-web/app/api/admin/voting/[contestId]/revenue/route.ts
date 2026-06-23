import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(
  request: Request,
  context: { params: Promise<{ contestId: string }> },
) {
  try {
    await assertAdminPermission(request, 'finance:view');
    const { contestId } = await context.params;
    const supabase = createAdminClient();

    // Aggregate by payment status
    const { data: txStats } = await supabase
      .from('vote_transactions')
      .select('payment_status, amount_paid, votes_purchased, bonus_votes, created_at')
      .eq('contest_id', contestId);

    const successful = (txStats ?? []).filter((t: any) => t.payment_status === 'successful');
    const failed = (txStats ?? []).filter((t: any) => t.payment_status === 'failed');
    const pending = (txStats ?? []).filter((t: any) => t.payment_status === 'pending');
    const refunded = (txStats ?? []).filter((t: any) => t.payment_status === 'refunded');

    const totalRevenue = successful.reduce((sum: number, t: any) => sum + Number(t.amount_paid ?? 0), 0);
    const totalVotesSold = successful.reduce(
      (sum: number, t: any) => sum + Number(t.votes_purchased ?? 0) + Number(t.bonus_votes ?? 0),
      0,
    );

    // Daily revenue (last 30 days)
    const dailyMap: Record<string, { revenue: number; transactions: number }> = {};
    for (const t of successful) {
      const day = (t.created_at as string).split('T')[0];
      if (!dailyMap[day]) dailyMap[day] = { revenue: 0, transactions: 0 };
      dailyMap[day].revenue += Number(t.amount_paid ?? 0);
      dailyMap[day].transactions += 1;
    }

    const dailyRevenue = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    // Revenue by package
    const { data: pkgStats } = await supabase
      .from('vote_transactions')
      .select('vote_package_id, amount_paid, vote_packages(name)')
      .eq('contest_id', contestId)
      .eq('payment_status', 'successful');

    const pkgMap: Record<string, { name: string; revenue: number; count: number }> = {};
    for (const t of pkgStats ?? []) {
      const pkgId = (t as any).vote_package_id ?? 'custom';
      const pkgName = (t as any).vote_packages?.name ?? 'Custom';
      if (!pkgMap[pkgId]) pkgMap[pkgId] = { name: pkgName, revenue: 0, count: 0 };
      pkgMap[pkgId].revenue += Number((t as any).amount_paid ?? 0);
      pkgMap[pkgId].count += 1;
    }

    return successResponse({
      success: true,
      contestId,
      totalRevenue,
      currency: 'NGN',
      successfulTransactions: successful.length,
      failedTransactions: failed.length,
      pendingTransactions: pending.length,
      refundedTransactions: refunded.length,
      totalVotesSold,
      averageTransactionValue: successful.length > 0 ? totalRevenue / successful.length : 0,
      dailyRevenue,
      revenueByPackage: Object.entries(pkgMap).map(([id, v]) => ({ packageId: id, packageName: v.name, ...v })),
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load revenue');
  }
}
