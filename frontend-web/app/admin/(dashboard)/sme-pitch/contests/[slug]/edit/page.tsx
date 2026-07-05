import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAdmin } from '@/src/lib/auth/server';
import { getRegistrationContestBySlug } from '@/src/server/registration/store';
import SmePitchContestForm from '@/components/sme-pitch/admin/SmePitchContestForm';

export const dynamic = 'force-dynamic';

export default async function EditSmePitchContestPage({ params }: { params: { slug: string } }) {
  try {
    await requireAdmin();
  } catch {
    redirect(`/login?next=/admin/sme-pitch/contests/${params.slug}/edit`);
  }

  const contest = getRegistrationContestBySlug(params.slug);
  if (!contest || contest.contestCategory !== 'sme_pitch') notFound();

  return (
    <section className="max-w-5xl mx-auto px-2 md:px-4 pb-6">
      <div className="flex items-center gap-2 text-xs text-foreground/40 mb-2">
        <Link href="/admin/sme-pitch">SME Pitch</Link>
        <span>/</span>
        <Link href={`/admin/sme-pitch/contests/${contest.slug}`}>{contest.title}</Link>
        <span>/</span>
        <span>Edit</span>
      </div>
      <h1 className="font-display text-3xl text-foreground">Edit SME Pitch Contest</h1>
      <p className="text-foreground-muted mt-1 mb-4">Update pitch contest registration settings, fees, locations, and entry controls.</p>
      <SmePitchContestForm mode="edit" contest={contest} />
    </section>
  );
}
