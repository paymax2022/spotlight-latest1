import { assertAdminPermission } from '@/src/server/admin/auth';
import { handleApiError, errorResponse } from '@/src/lib/api/responses';
import { createAdminClient } from '@/lib/supabase/server';

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ].join('\r\n');
}

export async function GET(
  request: Request,
  context: { params: Promise<{ contestId: string }> },
) {
  try {
    await assertAdminPermission(request, 'reports:export');
    const { contestId } = await context.params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') ?? 'votes';
    const supabase = createAdminClient();

    let csv = '';
    let filename = '';

    if (type === 'votes') {
      const { data } = await supabase
        .from('votes')
        .select('id,vote_type,vote_quantity,vote_status,contestant_id,voter_user_id,payment_reference,fraud_status,created_at,confirmed_at,reversed_at,reversal_reason')
        .eq('contest_id', contestId)
        .order('created_at', { ascending: false })
        .limit(50000);
      csv = toCsv((data ?? []) as Record<string, unknown>[]);
      filename = `votes-${contestId}.csv`;

    } else if (type === 'transactions') {
      const { data } = await supabase
        .from('vote_transactions')
        .select('id,payment_reference,provider_reference,voter_email,voter_name,contestant_id,votes_purchased,bonus_votes,total_votes_to_credit,amount_expected,amount_paid,currency,payment_status,vote_credit_status,paid_at,created_at')
        .eq('contest_id', contestId)
        .order('created_at', { ascending: false })
        .limit(50000);
      csv = toCsv((data ?? []) as Record<string, unknown>[]);
      filename = `transactions-${contestId}.csv`;

    } else if (type === 'leaderboard') {
      const { data } = await supabase
        .from('vote_totals')
        .select('contestant_id,rank,total_confirmed_votes,free_votes,paid_votes,bonus_votes,admin_adjustment_votes,reversed_votes,last_vote_at')
        .eq('contest_id', contestId)
        .order('total_confirmed_votes', { ascending: false })
        .limit(10000);
      csv = toCsv((data ?? []) as Record<string, unknown>[]);
      filename = `leaderboard-${contestId}.csv`;

    } else if (type === 'fraud') {
      const { data } = await supabase
        .from('fraud_flags')
        .select('id,flag_type,severity,description,status,contestant_id,voter_profile_id,created_at,reviewed_at,action_taken')
        .eq('contest_id', contestId)
        .order('created_at', { ascending: false })
        .limit(10000);
      csv = toCsv((data ?? []) as Record<string, unknown>[]);
      filename = `fraud-${contestId}.csv`;

    } else if (type === 'revenue') {
      const { data } = await supabase
        .from('vote_transactions')
        .select('payment_reference,voter_email,voter_name,contestant_id,votes_purchased,bonus_votes,amount_paid,currency,payment_status,paid_at')
        .eq('contest_id', contestId)
        .eq('payment_status', 'successful')
        .order('paid_at', { ascending: false })
        .limit(50000);
      csv = toCsv((data ?? []) as Record<string, unknown>[]);
      filename = `revenue-${contestId}.csv`;

    } else {
      return errorResponse('Invalid export type. Use: votes, transactions, leaderboard, fraud, revenue', 400);
    }

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return handleApiError(error, 'Export failed');
  }
}
