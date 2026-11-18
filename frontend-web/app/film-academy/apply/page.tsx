import { redirect } from 'next/navigation';

/**
 * The application is no longer a page of its own — it opens as a drawer over
 * the Film Academy service page. This route stays so existing links, bookmarks
 * and the mobile app's hand-off still reach the application, with ?batch=
 * carried through as the intake preselect.
 */
export default async function FilmAcademyApplyRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const batch = typeof params.batch === 'string' ? params.batch : undefined;
  redirect(`/service-details/film-academy?apply=1${batch ? `&batch=${encodeURIComponent(batch)}` : ''}`);
}
