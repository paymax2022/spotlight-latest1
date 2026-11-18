import { redirect } from 'next/navigation';
import { getActiveOpenMicEdition } from '@/src/features/openmic/active-edition';

export const dynamic = 'force-dynamic';

export default async function LegacyOpenMicApplyPage() {
  const edition = await getActiveOpenMicEdition();
  // No `|| contests[0]`: pointing someone straight at a draft or ended edition
  // is worse than the editions list on /open-mic, which at least names the
  // month and shows each edition's own status badge.
  redirect(edition ? `/open-mic/${edition.slug}/apply` : '/open-mic');
}
