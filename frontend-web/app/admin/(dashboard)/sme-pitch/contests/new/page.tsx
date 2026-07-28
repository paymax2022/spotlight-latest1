import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/src/lib/auth/server';
import SmePitchContestForm from '@/components/sme-pitch/admin/SmePitchContestForm';

export const dynamic = 'force-dynamic';

export default async function NewSmePitchContestPage() {
  try {
    await requireAdmin();
  } catch {
    redirect('/login?next=/admin/sme-pitch/contests/new');
  }

  return (
    <section className="max-w-5xl mx-auto px-2 md:px-4 pb-6">
      <div className="flex items-center gap-2 text-xs text-foreground/40 mb-2">
        <Link href="/admin/sme-pitch">SME Pitch</Link>
        <span>/</span>
        <span>New Contest</span>
      </div>
      <h1 className="font-display text-3xl text-foreground">Create SME Pitch Contest</h1>
      <p className="text-foreground-muted mt-1 mb-4">Configure the pitch contest registration route, fee, locations, and application rules.</p>
      <SmePitchContestForm mode="create" />
    </section>
  );
}
