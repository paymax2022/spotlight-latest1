import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/src/lib/auth/server';
import { redirect } from 'next/navigation';
import BatchInstallmentManager from '@/components/academy/admin/BatchInstallmentManager';
import ApplicationReviewRow from '@/components/academy/admin/ApplicationReviewRow';

export const dynamic = 'force-dynamic';

export default async function BatchDetailPage({ params }: { params: { batchId: string } }) {
  try { await requireAdmin(); } catch { redirect('/login?next=/admin/film-academy'); }

  const supabase = createAdminClient();
  const [batchRes, appsRes, plansRes] = await Promise.all([
    supabase.from('academy_batches').select('*').eq('id', params.batchId).maybeSingle(),
    supabase.from('academy_applications')
      .select('id, full_name, email, phone, status, payment_status, application_fee_paid, areas_of_interest, created_at')
      .eq('batch_id', params.batchId)
      .order('created_at', { ascending: false }),
    supabase.from('academy_installment_plans')
      .select('*, academy_installment_payments(*), academy_applications(full_name, email)')
      .eq('batch_id', params.batchId),
  ]);

  if (!batchRes.data) notFound();

  const batch = batchRes.data as any;
  const applications = (appsRes.data ?? []) as any[];
  const plans = (plansRes.data ?? []) as any[];

  const stats = {
    total: applications.length,
    pending: applications.filter((a) => a.status === 'pending').length,
    approved: applications.filter((a) => a.status === 'approved').length,
    rejected: applications.filter((a) => a.status === 'rejected').length,
    paid: applications.filter((a) => a.payment_status === 'paid').length,
  };

  return (
    <div className="max-w-6xl mx-auto px-4 pb-10">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-foreground/40 mb-2">
            <Link href="/admin/film-academy">Film Academy</Link>
            <span>/</span>
            <span>{batch.batch_name}</span>
          </div>
          <h1 className="font-display text-3xl text-foreground">{batch.batch_name}</h1>
          <p className="text-foreground/50 mt-1">
            {batch.start_date ? new Date(batch.start_date).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }) : 'No start date'} ·{' '}
            {batch.duration_weeks}w · {(batch.training_schedule ?? '').replace('_', ' ')}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/admin/film-academy/batches/${params.batchId}/edit`}
            className="btn-outline py-2 px-3 text-xs">
            Edit Batch
          </Link>
          <Link href={`/apply/film-academy?batch=${params.batchId}`} target="_blank"
            className="btn-outline py-2 px-3 text-xs">
            Application Link ↗
          </Link>
        </div>
      </div>

      {/* Stats row */}
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

      {/* Applications */}
      <div className="glass-card rounded-md overflow-hidden mb-6">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Applications</h2>
        </div>
        {applications.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-foreground/40 text-sm">No applications yet for this batch.</p>
            <p className="text-xs text-foreground/30 mt-1">Share the application link above.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {applications.map((app) => (
              <ApplicationReviewRow key={app.id} application={app} batchId={params.batchId} />
            ))}
          </div>
        )}
      </div>

      {/* Installment plans */}
      <BatchInstallmentManager
        batchId={params.batchId}
        applications={applications}
        plans={plans}
        batchFee={{
          training_fee_ngn:   Number(batch.training_fee_ngn ?? 0),
          installments_count: Number(batch.installments_count ?? 1),
          fee_frequency:      String(batch.fee_frequency ?? 'upfront'),
        }}
      />
    </div>
  );
}
