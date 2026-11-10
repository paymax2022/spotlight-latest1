import SmePitchApplicationWizard from '@/components/forms/SmePitchApplicationWizard';
import { getRegistrationContestBySlug } from '@/src/server/registration/store';
import { fontVariables } from './applicationFonts';
import { ApplicationFooter } from './ShowChrome';
import SeasonSiteChrome from './SeasonSiteChrome';

const CONTEST_SLUG = 'sme-pitch-contest';
const PROGRAMME_HREF = '/service-details/sme-pitch-contest';

// The five stages of the contest, in the order a founder actually meets them.
// The same route the programme page publishes; the numerals carry real sequence.
const ROUTE = [
  { n: '01', title: 'Apply', body: 'Submit your business profile and the problem you’re solving.' },
  { n: '02', title: 'Get screened', body: 'Reviewers assess eligibility, market fit and your evidence so far.' },
  { n: '03', title: 'Refine the pitch', body: 'Work on your story, numbers and funding ask with founder coaching.' },
  { n: '04', title: 'Pitch live', body: 'Present to a panel on customers, execution and growth.' },
  { n: '05', title: 'Follow through', body: 'Use the feedback to prepare for introductions and due diligence.' },
];

/**
 * /apply/sme-pitch-contest — the site template header over the Season 2
 * application page. The dark hero states the programme's facts, a process rail
 * sets out what happens after submission, and the cream sheet below is the
 * application.
 */
export default function SmePitchApply({ program }: { program: { title: string } }) {
  const contest = getRegistrationContestBySlug(CONTEST_SLUG);
  const edition = contest?.seasonOrEdition || '2026';
  const scope = contest?.regionScope === 'national' ? 'National' : 'Regional';
  const feeLabel = contest?.isPaid ? 'Paid entry' : 'Free';

  return (
    <>
      {/* Rendered outside .sp-season2 on purpose: season2.css scopes a sticky
          .site-header, img { width: 100% }, a { color: inherit } and a forced
          font-family to that wrapper, any of which would restyle the template
          logo and nav. Same split /season-2 makes. */}
      <SeasonSiteChrome />
      <div className={`sp-season2 sp-apply sp-sme ${fontVariables}`}>
        <a className="skip" href="#apply-form">
          Skip to the form
        </a>
        <main id="main">
          <section className="apply-hero wrap" aria-labelledby="apply-title">
            <div>
              <p className="eyebrow">
                <i></i> SPOTLIGHT SME PITCH <b></b> APPLICATION
              </p>
              <h1 id="apply-title">
                Build it. Pitch it.
                <br />
                <em>Make your next move.</em>
              </h1>
            </div>
            <div className="apply-hero-copy">
              <p>
                Four steps, saved as you go. Tell us about the business, upload your deck, and send
                your pitch to the review team. Entry is free — nothing is charged at any step.
              </p>
              <dl className="apply-facts">
                <div>
                  <dt>PROGRAMME</dt>
                  <dd>{program.title || contest?.title || 'Spotlight SME Pitch Contest'}</dd>
                </div>
                <div>
                  <dt>EDITION</dt>
                  <dd>{edition}</dd>
                </div>
                <div>
                  <dt>ENTRY FEE</dt>
                  <dd>{feeLabel}</dd>
                </div>
                <div>
                  <dt>SCOPE</dt>
                  <dd>{scope}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="sme-process" aria-labelledby="sme-process-title">
            <div className="wrap">
              <div className="sme-process-head">
                <p className="eyebrow">
                  <i></i> THE PROCESS <b></b> FIVE STAGES
                </p>
                <h2 id="sme-process-title">From application to follow-up.</h2>
              </div>
              <ol className="sme-route">
                {ROUTE.map((stage) => (
                  <li key={stage.n}>
                    <span>{stage.n}</span>
                    <h3>{stage.title}</h3>
                    <p>{stage.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="apply-body" id="apply-form" aria-label="SME Pitch Contest application form">
            <div className="wrap">
              <div className="apply-sheet">
                <SmePitchApplicationWizard />
              </div>
              <p className="apply-foot-note">
                Your draft is saved to your Spotlight account after each step, so you can leave and
                continue on any device. Applications are reviewed in the order they are submitted.
              </p>
            </div>
          </section>
        </main>
        <ApplicationFooter
          programmeHref={PROGRAMME_HREF}
          programmeLabel="The programme"
          footerTag="SPOTLIGHT SME PITCH / APPLICATIONS"
        />
      </div>
    </>
  );
}
