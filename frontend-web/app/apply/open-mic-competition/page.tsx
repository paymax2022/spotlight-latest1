import { redirect } from 'next/navigation';
import { getActiveOpenMicEdition } from '@/src/features/openmic/active-edition';

export const dynamic = 'force-dynamic';

export default async function LegacyOpenMicApplyPage() {
  const edition = await getActiveOpenMicEdition();
  // No `|| contests[0]`: when nothing is live there is nothing to apply to, and
  // pointing someone at a draft or ended edition is worse than the honest
  // "no live edition right now" on /open-mic.
  redirect(edition ? `/open-mic/${edition.slug}/apply` : '/open-mic');
}
