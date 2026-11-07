import type { Metadata } from 'next';
import { Barlow_Condensed, DM_Sans, Manrope } from 'next/font/google';
import MansionExperience from '@/components/season2/MansionExperience';
import { ChaptersProvider } from '@/components/season2/MansionChapters';
import RecapBand from '@/components/season2/RecapBand';
import { RegistrationPanelProvider, type SeasonFacts } from '@/components/season2/RegistrationPanel';
import SeasonFooter from '@/components/season2/SeasonFooter';
import SeasonHeader from '@/components/season2/SeasonHeader';
import SeasonHero from '@/components/season2/SeasonHero';
import SeasonTwoCta from '@/components/season2/SeasonTwoCta';
import { SEASON2_IMG, recapBands } from '@/components/season2/content';
import { getRegistrationContestBySlug, listRegistrationContests } from '@/src/server/registration/store';
import { listSeasons } from '@/src/server/services/reality-show/persistence';
import type { ShowSeason } from '@/src/server/services/reality-show/store';
import type { ContestRegistrationDefinition } from '@/src/features/registration/types';
import { formatNaira, formatProgrammeDate } from '../service-details/film-academy/format';
import '@/components/season2/season2.css';

/** The application the show's auditions are filed under. */
const SHOW_SLUG = 'reality-tv-show';

export const dynamic = 'force-dynamic';

const display = Barlow_Condensed({
  weight: ['500', '600', '700', '800'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
});
const ui = Manrope({
  weight: ['400', '500', '600', '700', '800'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-ui',
});
const body = DM_Sans({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
});

const TITLE = 'Inside the Spotlight Mansion | Season 1 Recap, Season 2 Registration';
const DESCRIPTION =
  'Relive Spotlight Season 1, from mansion life and celebrity visits to the grand finale. Register for Season 2.';
const HERO_IMAGE = `${SEASON2_IMG}/mansion-hero.webp`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/season-2' },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: '/season-2',
    images: [
      {
        url: HERO_IMAGE,
        width: 1200,
        height: 630,
        alt: 'Illustrative montage of mansion life, coaching, house tasks, group battles, a farewell and a live singer.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [HERO_IMAGE],
  },
};

/**
 * The page is recap copy plus whatever the platform has actually recorded about
 * the next season: the season row the show team keeps (its name and audition
 * window) and the contest definition the application is filed under (its title,
 * fee and requirements). Both are read server-side so an admin's edits show up
 * here on the next request.
 */
async function readSeasonFacts(): Promise<SeasonFacts> {
  const contest = getRegistrationContestBySlug(SHOW_SLUG);
  const season = await readNextSeason();

  return {
    // A season can be filed against a different contest, but /apply/[slug] only
    // renders programmes it knows, so the link moves only when the new slug is
    // registered — otherwise the button would 404.
    applyHref:
      season && listRegistrationContests().some((item) => item.slug === season.contestSlug)
        ? `/apply/${season.contestSlug}`
        : `/apply/${SHOW_SLUG}`,
    programmeName: contest?.title ?? 'Spotlight Reality TV Show',
    seasonName: season?.seasonName ?? null,
    feeLabel:
      contest?.isPaid && contest.registrationFeeNgn != null ? formatNaira(contest.registrationFeeNgn) : null,
    windowLabel: auditionWindow(season),
    eligibility: eligibilityLines(contest),
  };
}

/** The newest season that has not been called finished. listSeasons() is newest first. */
async function readNextSeason(): Promise<ShowSeason | null> {
  try {
    const seasons = await listSeasons();
    return seasons.find((item) => item.status !== 'completed') ?? null;
  } catch (error) {
    // An unreadable season row costs the page its dates, not the page itself.
    console.warn('[season-2] could not read the recorded seasons:', error);
    return null;
  }
}

function auditionWindow(season: ShowSeason | null): string | null {
  const start = formatProgrammeDate(season?.auditionStartDate);
  const end = formatProgrammeDate(season?.auditionEndDate);
  if (start && end) return `${start} – ${end}`;
  return start ?? end ?? null;
}

/**
 * Only what the form really asks, taken from the same definition the wizard is
 * built from, so the panel cannot promise a requirement that changed.
 */
function eligibilityLines(contest: ContestRegistrationDefinition | null | undefined): string[] {
  if (!contest) return [];
  const lines: string[] = [];
  if (contest.requiresGuardianConsentForMinors) {
    lines.push(`a parent or guardian’s consent for applicants under ${contest.legalAdultAge}`);
  }
  if (contest.requiresMedical) lines.push('a medical history and emergency-treatment consent');
  if (contest.requiresBootcampReadiness) lines.push('that you can commit to the full bootcamp period');
  if (contest.supportsVoting) lines.push('comfort with public voting and possible eviction');
  return lines;
}

export default async function Season2Page() {
  const facts = await readSeasonFacts();

  return (
    <div id="top" className={`sp-season2 ${display.variable} ${ui.variable} ${body.variable}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <RegistrationPanelProvider facts={facts}>
        <ChaptersProvider>
          <SeasonHeader />
          <main id="main">
            <SeasonHero />
            <MansionExperience />
            {recapBands.map((band) => (
              <RecapBand key={band.id} {...band} />
            ))}
            <SeasonTwoCta windowLabel={facts.windowLabel} seasonName={facts.seasonName} />
          </main>
          <SeasonFooter />
        </ChaptersProvider>
      </RegistrationPanelProvider>
    </div>
  );
}
