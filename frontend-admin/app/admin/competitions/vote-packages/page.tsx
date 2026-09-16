import { redirect } from 'next/navigation';

/**
 * Retired route — vote packages now live at /admin/voting/packages.
 *
 * Two package screens were built concurrently: this one (per-contest packages)
 * and a reusable template catalog. They were two halves of one job, so they are
 * merged there. This redirect stays because the contests list links here from
 * its "nobody can vote in this — click to fix" badges, and because operators
 * will have the URL. It forwards `contestId` so a fix-link still lands on the
 * contest the operator was looking at.
 */
export default async function RetiredVotePackagesRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params?.contestId;
  const contestId = Array.isArray(raw) ? raw[0] : raw;
  redirect(contestId ? `/admin/voting/packages?contestId=${encodeURIComponent(contestId)}` : '/admin/voting/packages');
}
