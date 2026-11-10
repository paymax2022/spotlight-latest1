import { redirect } from 'next/navigation';

/**
 * /apply/film-academy never existed as a real page. Several links (Film Academy
 * dashboard, fixed in #252) and at least one user bookmark/typed URL pointed at
 * this wrong path and 404'd. The application now opens as a drawer over the
 * Film Academy service page, so this lands there directly rather than hopping
 * through /film-academy/apply. Forwards ?batch= as the intake preselect.
 */
export default async function LegacyFilmAcademyApplyRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const batch = typeof params.batch === 'string' ? params.batch : undefined;
  redirect(`/service-details/film-academy?apply=1${batch ? `&batch=${encodeURIComponent(batch)}` : ''}`);
}
