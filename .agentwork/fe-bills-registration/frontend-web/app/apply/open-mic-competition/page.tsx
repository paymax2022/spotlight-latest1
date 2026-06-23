import { redirect } from 'next/navigation';
import { listContests } from '@/src/server/openmic/persistence';

export const dynamic = 'force-dynamic';

export default async function LegacyOpenMicApplyPage() {
  const contests = await listContests();
  const active =
    contests.find((row) =>
      ['registration_open', 'published', 'submission_open', 'voting_live'].includes(row.status)
    ) || contests[0];

  if (active) {
    redirect(`/open-mic/${active.slug}/apply`);
  }

  redirect('/open-mic');
}
