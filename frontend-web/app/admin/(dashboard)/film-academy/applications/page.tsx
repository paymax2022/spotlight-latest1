import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/src/lib/auth/server';
import ApplicationReviewRow from '@/components/academy/admin/ApplicationReviewRow';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams?: {
    batchId?: string;
    status?: string;
  };
};

const STATUS_FILTERS = ['pending', 'approved', 'rejected', 'waitlisted'];

export default async function AcademyApplicationsPage({ searchParams }: PageProps) {
  try {
    await requireAdmin();
  } catch {
    redirect('/login?next=/admin/film-academy/applications');
  }

  const batchId = searchParams?.batchId || '';
  const status = searchParams?.status || '';
  const supabase = createAdminClient();

  let applicationsQuery = supabase
    .from('academy_applications')
    .select('id, full_name, email, phone, status, payment_status, application_fee_paid, areas_of_interest, created_at, batch_id, academy_batches(batch_name)')
    .order('created_at', { ascending: false });

  if (batchId) applicationsQuery = applicationsQuery.eq('batch_id', batchId);
  if (status) applicationsQuery = applicationsQuery.eq('status', status);

  const [applicationsRes, batchRes] = await Promise.all([
    applicationsQuery,
    batchId
      ? supabase.from('academy_batches').select('id, batch_name, start_date, training_schedule, duration_weeks').eq('id', batchId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const applications = (applicationsRes.data ?? []) as any[];
  const batch = batchRes.data as any | null;

  const stats = {
    total: applications.length,
    pending: applications.filter((a) => a.status === 'pending').length,
    approved: applications.filter((a) => a.status === 'approved').length,
    rejected: applications.filter((a) => a.status === 'rejected').length,
    paid: applications.filter((a) => a.payment_status === 'paid').length,
  };

  function filterHref(nextStatus?: string) {
    const params = new URLSearchParams();
    if (batchId) params.set('batchId', batchId);
    if (nextStatus) params.set('status', nextStatus);
    const query = params.toString();
    return query ? `/admin/film-academy/applications?${query}` : '/admin/film-academy/applications';
  }

  return (
    <div className="max-w-6xl mx-auto px-4 pb-10">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-foreground/40 mb-2">
            <Link href="/admin/film-academy">Film Academy</Link>
            {batch ? (
              <>
                <span>/</span>
                <Link href={`/admin/film-academy/batches/${batch.id}`}>{batch.batch_name}</Link>
              </>
            ) : null}
            <span>/</span>
            <span>Applications</span>
          </div>
          <h1 className="font-display text-3xl text-foreground">
            {batch ? `${batch.batch_name} Applications` : 'Film Academy Applications'}
          </h1>
          <p className="text-foreground/50 mt-1">
            {batch
              ? `${batch.start_date ? new Date(batch.start_date).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }) : 'No start date'} · ${batch.duration_weeks ?? '-'}w · ${(batch.training_schedule ?? '').replace('_', ' ')}`
              : 'Review applications across all academy batches'}
          </p>
        </div>
        <div className="flex gap-2">
          {batchId ? (
            <Link href={`/admin/film-academy/batches/${batchId}`} className="btn-outline py-2 px-3 text-xs">
              Batch Details
            </Link>
          ) : null}
          <Link href="/admin/film-academy" className="btn-outline py-2 px-3 text-xs">
            Film Academy
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Total', value: stats.total, color: '#6366f1' },
          { label: 'Pending', value: stats.pending, color: '#f59e0b' },
          { label: 'Approved', value: stats.approved, color: '#10b981' },
          { label: 'Rejected', value: stats.rejected, color: '#ef4444' },
          { label: 'Paid', value: stats.paid, color: '#10b981' },
        ].map(({ label, value, color }) => (
          <div key={label} className="glass-card rounded-md p-4">
            <p className="text-xs text-foreground/50 mb-1">{label}</p>
            <p className="text-2xl font-bold" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      <div className="glass-card rounded-md overflow-hidden">
        <div className="flex items-center justify-between gap-3 flex-wrap p-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Applications</h2>
          <div className="flex gap-2 flex-wrap">
            <Link href={filterHref()} className={`btn-outline py-1.5 px-3 text-xs ${!status ? 'opacity-100' : 'opacity-60'}`}>
              All
            </Link>
            {STATUS_FILTERS.map((item) => (
              <Link key={item} href={filterHref(item)} className={`btn-outline py-1.5 px-3 text-xs ${status === item ? 'opacity-100' : 'opacity-60'}`}>
                {item}
              </Link>
            ))}
          </div>
        </div>

        {applicationsRes.error ? (
          <div className="p-8 text-center">
            <p className="text-red-500 text-sm">Failed to load academy applications.</p>
          </div>
        ) : applications.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-foreground/40 text-sm">No applications found.</p>
            <p className="text-xs text-foreground/30 mt-1">
              {batchId ? 'No applicants have applied for this batch yet.' : 'Applications will appear here after applicants submit.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {applications.map((application) => (
              <ApplicationReviewRow
                key={application.id}
                application={application}
                batchId={application.batch_id || batchId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
