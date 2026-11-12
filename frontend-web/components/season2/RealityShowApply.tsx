import RealityTvShowApplicationWizard from '@/components/forms/RealityTvShowApplicationWizard';
import { getRegistrationContestBySlug, listRegistrationContests } from '@/src/server/registration/store';
import { listSeasons } from '@/src/server/services/reality-show/persistence';
import { formatNaira, formatProgrammeDate } from '@/app/service-details/film-academy/format';
import type { SeasonFacts } from './RegistrationPanel';
import { fontVariables } from './applicationFonts';
import { ApplicationFooter, ApplicationHeader } from './ShowChrome';

const SHOW_SLUG = 'reality-tv-show';

/**
 * Reads only what the page can state as fact: the contest definition the form
 * is built from (title, fee, requirements) and the newest season the show team
 * has recorded. A missing season costs the page its dates, not the page.
 */
async function readFacts(): Promise<SeasonFacts> {
  const contest = getRegistrationContestBySlug(SHOW_SLUG);
  let seasonName: string | null = null;
  let windowLabel: string | null = null;

  try {
    const seasons = await listSeasons();
    const season = seasons.find((item) => item.status !== 'completed') ?? null;
    seasonName = season?.seasonName ?? null;
    const start = formatProgrammeDate(season?.auditionStartDate);
    const end = formatProgrammeDate(season?.auditionEndDate);
    windowLabel = start && end ? `${start} – ${end}` : start ?? end ?? null;
  } catch (error) {
    console.warn('[apply] could not read the recorded seasons:', error);
  }

  const appliable = listRegistrationContests().some((item) => item.slug === SHOW_SLUG);

  return {
    applyHref: appliable ? `/apply/${SHOW_SLUG}` : '/apply',
    programmeName: contest?.title ?? 'Spotlight Reality TV Show',
    seasonName,
    feeLabel:
      contest?.isPaid && contest.registrationFeeNgn != null ? formatNaira(contest.registrationFeeNgn) : null,
    windowLabel,
    eligibility: [],
  };
}

/**
 * /apply/reality-tv-show — the Season 2 chrome around the real wizard. The dark
 * hero states the programme's facts; the cream sheet below is the application
 * itself, unchanged in behaviour but restyled to the show's type system.
 */
export default async function RealityShowApply({ program }: { program: { title: string } }) {
  const facts = await readFacts();

  return (
    <div className={`sp-season2 sp-apply ${fontVariables}`}>
      <a className="skip" href="#apply-form">
        Skip to the form
      </a>
      <ApplicationHeader />
      <main id="main">
        <section className="apply-hero wrap" aria-labelledby="apply-title">
          <div>
            <p className="eyebrow">
              <i></i> SPOTLIGHT REALITY TV <b></b> APPLICATION
            </p>
            <h1 id="apply-title">
              Claim your place
              <br />
              <em>in the mansion.</em>
            </h1>
          </div>
          <div className="apply-hero-copy">
            <p>
              Five steps, saved as you go. Your entry goes straight to the review team, and the
              entry fee is taken at the final step through Paystack.
            </p>
            <dl className="apply-facts">
              <div>
                <dt>PROGRAMME</dt>
                <dd>{program.title || facts.programmeName}</dd>
              </div>
              {facts.seasonName ? (
                <div>
                  <dt>SEASON</dt>
                  <dd>{facts.seasonName}</dd>
                </div>
              ) : null}
              <div>
                <dt>AUDITION WINDOW</dt>
                <dd>{facts.windowLabel ?? 'To be announced'}</dd>
              </div>
              <div>
                <dt>ENTRY FEE</dt>
                <dd>{facts.feeLabel ?? 'None published'}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="apply-body" id="apply-form" aria-label="Reality TV Show application form">
          <div className="wrap">
            <div className="apply-sheet">
              <RealityTvShowApplicationWizard />
            </div>
            <p className="apply-foot-note">
              Your draft is saved to your Spotlight account after each step, so you can leave and
              continue on any device. Applications are reviewed in the order they are submitted.
            </p>
          </div>
        </section>
      </main>
      <ApplicationFooter />
    </div>
  );
}
