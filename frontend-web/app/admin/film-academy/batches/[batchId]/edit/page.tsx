import { notFound, redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/src/lib/auth/server';
import AcademyBatchForm from '@/components/academy/admin/AcademyBatchForm';

export const dynamic = 'force-dynamic';

export default async function EditBatchPage({ params }: { params: { batchId: string } }) {
  try {
    await requireAdmin();
  } catch {
    redirect('/login?next=/admin/film-academy');
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('academy_batches')
    .select('*')
    .eq('id', params.batchId)
    .maybeSingle();

  if (error || !data) notFound();

  return <AcademyBatchForm mode="edit" batchId={params.batchId} initialBatch={data as Record<string, any>} />;
}
