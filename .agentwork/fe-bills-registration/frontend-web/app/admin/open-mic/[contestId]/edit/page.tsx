import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContestById } from '@/src/server/openmic/persistence';
import OpenMicAdminContestEditor from '@/components/openmic/OpenMicAdminContestEditor';

export const dynamic = 'force-dynamic';

export default async function AdminOpenMicEditContestPage({ params }: { params: { contestId: string } }) {
  const contest = await getContestById(params.contestId);
  if (!contest) notFound();

  return (
    <section className="max-w-5xl mx-auto px-2 md:px-4 pb-6">
      <h1 className="font-display text-3xl text-foreground">Edit Open Mic Contest</h1>
      <p className="text-foreground-muted mt-1">{contest.title}</p>
      <div className="glass-card rounded-md p-4 mt-4">
        <OpenMicAdminContestEditor contest={contest} />
        <div className="mt-3 flex gap-2 flex-wrap">
          <Link href="/admin/open-mic/contests/new" className="btn-outline py-2 px-3 text-xs">Create New Edition</Link>
          <Link href={`/admin/open-mic/${contest.id}/reports`} className="btn-primary py-2 px-3 text-xs">View Reports</Link>
        </div>
      </div>
    </section>
  );
}
