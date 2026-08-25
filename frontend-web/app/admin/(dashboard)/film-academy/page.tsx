import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/src/lib/auth/server';
import { redirect } from 'next/navigation';
import { summariseAcademyRevenue, formatNaira } from '@/src/features/academy/revenue';

export const dynamic = 'force-dynamic';

async function getData() {
  const supabase = createAdminClient();
  const [batchesRes, appsRes, paymentsRes] = await Promise.all([
    supabase.from('academy_batches').select('*').order('created_at', { ascending: false }),
    // application_fee_paid is the NAIRA amount collected at application time — it is
    // money, and it was being dropped from this page entirely.
    supabase.from('academy_applications').select('id, status, payment_status, batch_id, application_fee_paid'),
    // The plan's status rides along because a cancelled plan's schedule is not owed.
    supabase
      .from('academy_installment_payments')
      .select('id, amount_ngn, status, due_date, paid_at, installment_number, payment_reference, academy_installment_plans(status, academy_applications(full_name))')
      .order('paid_at', { ascending: false, nullsFirst: false }),
  ]);
  return {
    batches: (batchesRes.data ?? []) as any[],
    applications: (appsRes.data ?? []) as any[],
    payments: (paymentsRes.data ?? []) as any[],
  };
}

export default async function FilmAcademyAdminPage() {
  try { await requireAdmin(); } catch { redirect('/login?next=/admin/film-academy'); }

  const { batches, applications, payments } = await getData();

  const revenue = summariseAcademyRevenue(
    applications,
    payments.map((p) => ({
      amount_ngn: p.amount_ngn,
      status: p.status,
      due_date: p.due_date,
      planStatus: p.academy_installment_plans?.status ?? null,
    })),
  );
  const settled = payments.filter((p) => p.status === 'paid').slice(0, 8);

  const stats = {
    totalBatches: batches.length,
    activeBatches: batches.filter((b) => b.status === 'ongoing').length,
    totalApplications: applications.length,
    pending: applications.filter((a) => a.status === 'pending').length,
    approved: applications.filter((a) => a.status === 'approved').length,
    pendingPayment: applications.filter((a) => a.payment_status === 'pending').length,
  };

  return (
    <div className="max-w-6xl mx-auto px-4 pb-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl text-foreground">Film Academy</h1>
          <p className="text-foreground/50 mt-1">Manage batches, applications, and training fees</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/film-academy/curriculum" className="btn-outline py-2 px-4 text-sm">
            Curriculum
          </Link>
          <Link href="/admin/film-academy/submissions" className="btn-outline py-2 px-4 text-sm">
            Submissions
          </Link>
          <Link href="/admin/film-academy/settings" className="btn-outline py-2 px-4 text-sm">
            Academy Settings
          </Link>
          <Link href="/admin/film-academy/batches/new" className="btn-primary py-2 px-4 text-sm">
            + New Batch
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {[
          { label: 'Total Batches',    value: stats.totalBatches,      color: '#6366f1' },
          { label: 'Active Batches',   value: stats.activeBatches,     color: '#10b981' },
          { label: 'Applications',     value: stats.totalApplications, color: '#f59e0b' },
          { label: 'Pending Review',   value: stats.pending,           color: '#f97316' },
          { label: 'Approved',         value: stats.approved,          color: '#10b981' },
          // This counts payment_status, which is the APPLICATION FEE — not tuition.
          // Labelled "Awaiting Payment" it read as unpaid training fees, which live on
          // the instalment plan and are in the money tiles below.
          { label: 'App Fee Due',     value: stats.pendingPayment,    color: '#ef4444' },
        ].map(({ label, value, color }) => (
          <div key={label} className="glass-card rounded-md p-4">
            <p className="text-xs text-foreground/50 mb-1">{label}</p>
            <p className="text-2xl font-bold" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Money. The page has always promised "training fees"; until now it showed none. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
        {[
          {
            label: 'Fees Collected',
            value: formatNaira(revenue.collectedNgn),
            note: `${formatNaira(revenue.applicationFeesNgn)} application · ${formatNaira(revenue.instalmentsPaidNgn)} training`,
            color: '#10b981',
          },
          {
            label: 'Outstanding',
            value: formatNaira(revenue.outstandingNgn),
            note: 'scheduled, not yet settled',
            color: revenue.outstandingNgn > 0 ? '#f59e0b' : '#64748b',
          },
          {
            label: 'Overdue',
            value: formatNaira(revenue.overdueNgn),
            note: 'past its due date',
            color: revenue.overdueNgn > 0 ? '#ef4444' : '#64748b',
          },
        ].map(({ label, value, note, color }) => (
          <div key={label} className="glass-card rounded-md p-4">
            <p className="text-xs text-foreground/50 mb-1">{label}</p>
            <p className="text-2xl font-bold" style={{ color }}>{value}</p>
            <p className="text-[11px] text-foreground/40 mt-1">{note}</p>
          </div>
        ))}
      </div>

      {/* Recent payments */}
      <div className="glass-card rounded-md overflow-hidden mb-6">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Recent Payments</h2>
          <span className="text-xs text-foreground/40">{payments.filter((p) => p.status === 'paid').length} settled</span>
        </div>
        {settled.length === 0 ? (
          <p className="p-6 text-center text-sm text-foreground/50">No training-fee payments settled yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg/50">
                  <th className="text-left px-4 py-3 text-foreground/50 font-medium">Applicant</th>
                  <th className="text-left px-4 py-3 text-foreground/50 font-medium">Instalment</th>
                  <th className="text-right px-4 py-3 text-foreground/50 font-medium">Amount</th>
                  <th className="text-left px-4 py-3 text-foreground/50 font-medium">Paid</th>
                  <th className="text-left px-4 py-3 text-foreground/50 font-medium">Reference</th>
                </tr>
              </thead>
              <tbody>
                {settled.map((p) => (
                  <tr key={p.id} className="border-b border-border hover:bg-bg/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {p.academy_installment_plans?.academy_applications?.full_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-foreground/70">#{p.installment_number}</td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">{formatNaira(Number(p.amount_ngn ?? 0))}</td>
                    <td className="px-4 py-3 text-foreground/70">
                      {p.paid_at ? new Date(p.paid_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-3 text-foreground/50 text-xs font-mono">{p.payment_reference ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Batch list */}
      <div className="glass-card rounded-md overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Intake Batches</h2>
          <div className="flex gap-2">
            <Link href="/admin/film-academy/settings" className="btn-outline py-1.5 px-3 text-xs">
              Settings
            </Link>
            <Link href="/admin/film-academy/batches/new" className="btn-outline py-1.5 px-3 text-xs">
              + Create Batch
            </Link>
          </div>
        </div>

        {batches.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-4xl mb-3">🎬</p>
            <p className="text-foreground/50 mb-4">No batches yet. Create your first intake batch.</p>
            <Link href="/admin/film-academy/batches/new" className="btn-primary py-2 px-5 text-sm">
              Create First Batch
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg/50">
                  <th className="text-left px-4 py-3 text-foreground/50 font-medium">Batch Name</th>
                  <th className="text-left px-4 py-3 text-foreground/50 font-medium">Start Date</th>
                  <th className="text-left px-4 py-3 text-foreground/50 font-medium">Schedule</th>
                  <th className="text-left px-4 py-3 text-foreground/50 font-medium">Duration</th>
                  <th className="text-right px-4 py-3 text-foreground/50 font-medium">Enrolled</th>
                  <th className="text-left px-4 py-3 text-foreground/50 font-medium">Status</th>
                  <th className="text-right px-4 py-3 text-foreground/50 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const appCount = applications.filter((a) => a.batch_id === b.id).length;
                  return (
                    <tr key={b.id} className="border-b border-border hover:bg-bg/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{b.batch_name}</td>
                      <td className="px-4 py-3 text-foreground/70">
                        {b.start_date ? new Date(b.start_date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-4 py-3 text-foreground/70 capitalize">{(b.training_schedule ?? '').replace('_', ' ')}</td>
                      <td className="px-4 py-3 text-foreground/70">{b.duration_weeks ? `${b.duration_weeks}w` : '—'}</td>
                      <td className="px-4 py-3 text-right text-foreground/70">
                        {appCount}{b.max_students ? `/${b.max_students}` : ''}
                      </td>
                      <td className="px-4 py-3">
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                          background: b.status === 'ongoing' ? 'rgba(16,185,129,0.15)' : b.status === 'upcoming' ? 'rgba(99,102,241,0.15)' : 'rgba(100,116,139,0.15)',
                          color: b.status === 'ongoing' ? '#10b981' : b.status === 'upcoming' ? '#6366f1' : '#64748b',
                        }}>
                          {(b.status ?? 'upcoming').replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <Link href={`/admin/film-academy/batches/${b.id}`} className="btn-outline py-1 px-2 text-xs">
                            Manage
                          </Link>
                          <Link href={`/admin/film-academy/batches/${b.id}/edit`} className="btn-outline py-1 px-2 text-xs">
                            Edit
                          </Link>
                          <Link href={`/admin/film-academy/applications?batchId=${b.id}`} className="btn-outline py-1 px-2 text-xs">
                            Applications ({appCount})
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent applications */}
      {applications.length > 0 && (
        <div className="glass-card rounded-md overflow-hidden mt-6">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h2 className="font-semibold text-foreground">Recent Applications</h2>
            <Link href="/admin/film-academy/applications" className="text-xs text-foreground/50 hover:text-foreground">
              View all →
            </Link>
          </div>
          <p className="px-4 py-3 text-sm text-foreground/50">{applications.length} total · {stats.pending} pending review · {stats.pendingPayment} awaiting payment</p>
        </div>
      )}
    </div>
  );
}
