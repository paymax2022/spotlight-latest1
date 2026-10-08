import { redirect } from 'next/navigation';

/**
 * /apply/film-academy never existed as a real page — the actual application
 * form is app/film-academy/apply/page.tsx, mounted at /film-academy/apply.
 * Several links (Film Academy dashboard, fixed in #252) and at least one user
 * bookmark/typed URL pointed at this wrong path and 404'd. This redirect
 * exists so that stale links, bookmarks, and muscle memory land on the real
 * page instead of a dead end. Forwards ?batch= so a deep link into a specific
 * batch still prefills correctly on the real page.
 */
export default async function LegacyFilmAcademyApplyRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const batch = typeof params.batch === 'string' ? params.batch : undefined;
  redirect(batch ? `/film-academy/apply?batch=${encodeURIComponent(batch)}` : '/film-academy/apply');
}
