import Layout from '@/components/layout/Layout';
import Link from 'next/link';
import { DM_Sans, Manrope, Oswald } from 'next/font/google';
import type { Metadata } from 'next';
import { getAcademyCatalogue } from '@/src/server/services/academy/catalogue';
import AcademyMotion from './AcademyMotion';
import HeaderSpacer from './HeaderSpacer';
import AcademyApplyProvider, { ApplyLink } from './ApplyDrawer';
import AreaExplorer from './AreaExplorer';
import TuitionPlanner from './TuitionPlanner';
import { ACADEMY_CONTACT, whatsappEnquiry } from './contact';
import { formatNaira, formatProgrammeDate, intakePhase, scheduleLabel } from './format';
import styles from './academy.module.css';

// The catalogue is read per request: tuition, areas and intakes are
// admin-managed rows, and a build-time snapshot would quietly serve prices the
// application endpoint no longer charges.
export const dynamic = 'force-dynamic';

const oswald = Oswald({ weight: ['500', '600', '700'], subsets: ['latin'], display: 'swap', variable: '--font-oswald' });
const manrope = Manrope({
  weight: ['400', '500', '600', '700', '800'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-manrope',
});
const dmSans = DM_Sans({ weight: ['400', '500', '600', '700'], subsets: ['latin'], display: 'swap', variable: '--font-dm-sans' });

const HERO_IMAGE = '/assets/img/film-academy/hero.webp';
const SET_IMAGE = '/assets/img/film-academy/on-set.jpg';

export const metadata: Metadata = {
  title: 'Spotlight Film Academy | Train on real sets in Lagos',
  description:
    'Areas of study, training formats and tuition for the Spotlight Film Academy in Lekki, Lagos — acting, directing, cinematography, editing, sound, producing, production design and script writing, taught through real movie projects.',
  openGraph: {
    title: 'Spotlight Film Academy | Train on real sets in Lagos',
    description: 'Choose a craft, pick a training format, and see the tuition admissions actually charges.',
    images: [{ url: HERO_IMAGE, width: 1586, height: 992, alt: 'Spotlight Film Academy trainees at work on a film set.' }],
  },
};

const JOURNEY = [
  {
    kicker: '01 / GET STARTED',
    title: 'Meet your craft. Find your crew.',
    body:
      'Your first sessions build the foundations with your instructors, put you alongside other trainees, and prepare you for the productions you will work on.',
    footer: 'Learn the fundamentals',
    accent: false,
  },
  {
    kicker: '02 / ON SET',
    title: 'Your ideas, in the frame.',
    body:
      'The lessons turn into practice on movie projects — planning the shot, finding the light, and working as a crew to bring a scene in.',
    footer: 'Create together',
    accent: true,
  },
  {
    kicker: '03 / KEEP CREATING',
    title: 'Take the skills. Tell your story.',
    body:
      'You leave with the work you made, the people you made it with, and a clear next project to put the craft on.',
    footer: 'Build your next chapter',
    accent: false,
  },
];

export default async function FilmAcademyPage() {
  const { areas, intakes, pricingStructure, deliverables, feeExclusions, maxAreas, settings, loadErrors } =
    await getAcademyCatalogue();

  const allPrices = areas.flatMap((area) => area.pricing_options.map((option) => option.price_ngn));
  const priceFloor = allPrices.length > 0 ? Math.min(...allPrices) : null;
  // An intake with no linked trainings accepts no application, so it gets a
  // note rather than a card with a button that cannot work.
  const joinableIntakes = intakes.filter((intake) => intake.areaSlugs.length > 0);
  const unpublishedIntakes = intakes.filter((intake) => intake.areaSlugs.length === 0);
  const unpublishedDates = unpublishedIntakes
    .map((intake) => formatProgrammeDate(intake.start_date))
    .filter((date): date is string => date !== null);
  const lastUnpublishedDate = unpublishedDates[unpublishedDates.length - 1];
  const unpublishedRange =
    unpublishedDates.length === 0
      ? null
      : unpublishedDates[0] === lastUnpublishedDate
        ? unpublishedDates[0]
        : `${unpublishedDates[0]} to ${lastUnpublishedDate}`;
  const areaLabel = new Map(areas.map((area) => [area.slug, area.label]));
  const programmeLengths = Array.from(
    new Set(intakes.map((intake) => intake.duration_weeks).filter((weeks): weeks is number => Number(weeks) > 0)),
  ).sort((a, b) => a - b);

  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={false}
      breadcrumbTitle={null}
      breadcrumbClassName={undefined}
      breadcrumbPadding={undefined}
    >
      <AcademyApplyProvider fontClassName={`${oswald.variable} ${manrope.variable} ${dmSans.variable}`}>
      <div
        className={`${styles.page} ${oswald.variable} ${manrope.variable} ${dmSans.variable}`}
        data-academy-root
      >
        <AcademyMotion />
        <HeaderSpacer />

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className={styles.hero} aria-label="Spotlight Film Academy, Lekki Lagos">
          <div className={`${styles.wrap} ${styles.heroTop}`} data-reveal>
            <span className={styles.eyebrow}>
              <span className={styles.liveDot} aria-hidden="true" />
              Academy / Lekki, Lagos
            </span>
            <span className={styles.sectionIndex}>01 — Your story starts here</span>
          </div>

          <div className={styles.wrap}>
            <div className={styles.heroVisual} data-hero-visual>
              <picture>
                <source type="image/webp" srcSet={HERO_IMAGE} />
                <img
                  className={styles.heroBanner}
                  src="/assets/img/film-academy/hero.png"
                  alt="Spotlight Film Academy trainees on film sets — actors, directors, camera, sound, edit and art departments at work."
                  fetchPriority="high"
                  width={1586}
                  height={992}
                />
              </picture>
              <span className={styles.heroGlow} aria-hidden="true" />
              <span className={styles.heroSweep} aria-hidden="true" />
              <span className={styles.heroGrain} aria-hidden="true" />
              <span className={`${styles.heroCorner} ${styles.cornerTl}`} aria-hidden="true" />
              <span className={`${styles.heroCorner} ${styles.cornerBr}`} aria-hidden="true" />
              <span className={styles.heroTag} aria-hidden="true">
                <span className={styles.liveDot} /> Real stories. Real sets.
              </span>

              <div className={styles.heroTitleMobile}>
                <span className={styles.eyebrow}>Spotlight Film Academy</span>
                <h2>
                  Explore your
                  <br />
                  <em>passion</em>
                </h2>
                <p>Learn the craft. Find your crew. Step onto a real movie set.</p>
                <Link className={styles.btn} href="#areas">
                  Explore the areas of study <span aria-hidden="true">↓</span>
                </Link>
              </div>
            </div>
          </div>

          <div className={`${styles.wrap} ${styles.heroBottom}`} data-reveal>
            <div className={styles.heroBottomCopy}>
              <span className={styles.overline}>
                <i aria-hidden="true" /> Next chapter: yours
              </span>
              <h2>
                Train on the <em>weekend.</em>
                <br />
                Shoot real films before you <em>finish.</em>
              </h2>
            </div>
            <div className={styles.heroActions}>
              <ApplyLink className={`${styles.btn} ${styles.btnPrimary}`}>
                Apply to the academy <span aria-hidden="true">↗</span>
              </ApplyLink>
              {/* The pricing section only renders once areas are published, so the
                  jump link is dropped rather than left pointing at an empty target. */}
              {areas.length > 0 ? (
                <Link className={`${styles.btn} ${styles.btnOutline}`} href="#plan">
                  Price your training <span aria-hidden="true">↓</span>
                </Link>
              ) : null}
            </div>
          </div>
        </section>

        {/* ── Intro band ───────────────────────────────────────────────── */}
        <section className={`${styles.paper} ${styles.onPaper} ${styles.intro}`}>
          <div className={`${styles.wrap} ${styles.introGrid}`} data-reveal>
            <p className={styles.label}>
              A film school for doers
              <br />
              Lekki, Lagos
            </p>
            <h1 className={styles.display} id="intro-title">
              You have a story.
              <br />
              <em>Learn how to tell it.</em>
            </h1>
            <p className={styles.lede}>
              Step into the world behind the screen. Choose a craft, train with people who make films for a living,
              and turn the idea you have been carrying into work you can show.
            </p>
          </div>

          <div className={`${styles.wrap} ${styles.facts}`}>
            {areas.length > 0 ? (
              <>
                <div className={styles.fact}>
                  <strong>{String(areas.length).padStart(2, '0')}</strong>
                  <span>Areas of study to choose from</span>
                </div>
                <div className={styles.fact}>
                  <strong>{String(pricingStructure.length).padStart(2, '0')}</strong>
                  <span>Training formats, priced per area</span>
                </div>
                <div className={styles.fact}>
                  <strong>{String(intakes.length).padStart(2, '0')}</strong>
                  <span>Intakes on the calendar</span>
                </div>
              </>
            ) : null}
            <Link className={styles.factLink} href="#areas">
              Find your place on set <span aria-hidden="true">↘</span>
            </Link>
          </div>
        </section>

        {loadErrors.length > 0 ? (
          <div className={styles.wrap}>
            <p className={styles.warning}>
              <span aria-hidden="true">!</span>
              Some catalogue details ({loadErrors.join(', ')}) could not be read right now, so the numbers here may be
              incomplete. Confirm them with admissions before you pay anything.
            </p>
          </div>
        ) : null}

        {/* ── Areas of study ───────────────────────────────────────────── */}
        <section className={styles.craft} id="areas">
          <div className={styles.wrap}>
            <div className={styles.sectionHead} data-reveal>
              <div>
                <p className={styles.label}>01 / Find your creative path</p>
                <h2 className={styles.display}>
                  Every great film.
                  <br />
                  <em>Many brilliant crafts.</em>
                </h2>
              </div>
              <p className={styles.sectionKicker}>
                In front of the camera or behind the scenes. Choose the area you want to train in — an application can
                carry up to {maxAreas} of them.
              </p>
            </div>

            {areas.length > 0 ? (
              <AreaExplorer areas={areas} />
            ) : (
              <p className={styles.lede}>
                The areas offered for the next intake are confirmed by admissions.
              </p>
            )}
          </div>
        </section>

        {/* ── On set ───────────────────────────────────────────────────── */}
        <section className={styles.set} id="experience">
          <div className={styles.setImage}>
            <img src={SET_IMAGE} alt="Illustrative scene of a director guiding actors while a camera operator prepares a shot." loading="lazy" />
            <div className={styles.viewfinder}>
              <span>Spotlight / the learning experience</span>
              <h2>
                This is your
                <br />
                classroom.
              </h2>
            </div>
          </div>

          <div className={`${styles.wrap} ${styles.storyBottom}`}>
            <div data-reveal>
              <h2 className={styles.display}>
                Less watching.
                <br />
                <em>More making.</em>
              </h2>
              <p className={styles.lede}>
                Training follows the rhythm of a working production: rehearse, plan the shot, find the light, then work
                together to bring a scene to life.
              </p>
            </div>
            <div data-reveal>
              <p className={styles.label}>What the programme is built to deliver</p>
              <ul className={styles.deliverables}>
                {deliverables.map((item, index) => (
                  <li key={item}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── Plan and price ───────────────────────────────────────────── */}
        {areas.length > 0 ? (
          <section className={styles.plan} id="plan">
            <div className={styles.wrap}>
              <div className={styles.sectionHead} data-reveal>
                <div>
                  <p className={styles.label}>02 / Make room for your ambition</p>
                  <h2 className={styles.display}>
                    Build your plan.
                    <br />
                    <em>See the price.</em>
                  </h2>
                </div>
                <p className={styles.sectionKicker}>
                  Tuition is priced per area of study, in the format you choose{priceFloor !== null ? ` — from ${formatNaira(priceFloor)} per area` : ''}.
                  Selecting a second area adds its own format price.
                </p>
              </div>
              <TuitionPlanner
                areas={areas}
                maxAreas={maxAreas}
                applicationFeeNgn={settings?.registration_type === 'paid' ? settings.application_fee : null}
                applicationFeeRefundable={settings ? settings.application_fee_refundable : null}
                feeExclusions={feeExclusions}
              />
            </div>
          </section>
        ) : null}

        {/* ── Intakes ──────────────────────────────────────────────────── */}
        <section className={styles.intakes} id="intakes">
          <div className={styles.wrap}>
            <div className={styles.sectionHead} data-reveal>
              <div>
                <p className={styles.label}>03 / Your time at Spotlight</p>
                <h2 className={styles.display}>
                  When the next
                  <br />
                  <em>cohort starts.</em>
                </h2>
              </div>
              <p className={styles.sectionKicker}>
                Each intake carries its own schedule, start date and length. Applications open for the areas that
                intake runs.
              </p>
            </div>

            {joinableIntakes.length > 0 ? (
              <div className={styles.intakeGrid} data-reveal>
                {joinableIntakes.map((intake) => {
                  const startDate = formatProgrammeDate(intake.start_date);
                  const schedule = scheduleLabel(intake.training_schedule);
                  return (
                    <article key={intake.id} className={`${styles.intake} ${styles.intakeAccent}`}>
                      <span>{intakePhase(intake)}</span>
                      <h3>{intake.batch_name}</h3>
                      {startDate ? <p className={styles.intakeDate}>{startDate}</p> : null}
                      <p className={styles.intakeMeta}>
                        {schedule ? (
                          <span>
                            <b>{schedule}</b>
                          </span>
                        ) : null}
                        {intake.duration_weeks ? (
                          <span>
                            <b>{intake.duration_weeks}</b> weeks
                          </span>
                        ) : null}
                      </p>

                      <ul className={styles.intakeAreas}>
                        {intake.areaSlugs.map((slug) => (
                          <li key={slug}>{areaLabel.get(slug) ?? slug}</li>
                        ))}
                      </ul>
                      <ApplyLink className={styles.action} batch={intake.id}>
                        Apply for {intake.batch_name} <span aria-hidden="true">↗</span>
                      </ApplyLink>
                    </article>
                  );
                })}
              </div>
            ) : intakes.length === 0 ? (
              <p className={styles.lede} data-reveal>
                No dated intake is published yet.{' '}
                <a
                  className={styles.inlineLink}
                  href={whatsappEnquiry('Hello Spotlight, when does the next Film Academy cohort start?')}
                >
                  Ask admissions on WhatsApp <span aria-hidden="true">↗</span>
                </a>
              </p>
            ) : (
              <p className={styles.lede} data-reveal>
                No intake is open for application on this page right now — the academy team confirms the next cohort
                directly.{' '}
                <a
                  className={styles.inlineLink}
                  href={whatsappEnquiry('Hello Spotlight, which Film Academy intakes can I apply for right now?')}
                >
                  Ask admissions on WhatsApp <span aria-hidden="true">↗</span>
                </a>
              </p>
            )}

            {unpublishedIntakes.length > 0 ? (
              <p className={styles.intakeNote}>
                {unpublishedIntakes.length} {unpublishedIntakes.length === 1 ? 'intake is' : 'intakes are'} on the
                calendar{unpublishedRange ? `, starting ${unpublishedRange}` : ''}, each waiting for admissions to
                confirm which trainings it runs.
              </p>
            ) : null}
          </div>
        </section>

        {/* ── Journey ──────────────────────────────────────────────────── */}
        <section className={styles.journey}>
          <div className={styles.wrap}>
            <div className={styles.sectionHead} data-reveal>
              <div>
                <p className={styles.label}>From your first class</p>
                <h2 className={styles.display}>
                  To your
                  <br />
                  <em>final take.</em>
                </h2>
              </div>
              <p className={styles.sectionKicker}>
                A practical journey, with{' '}
                {joinableIntakes.length > 0
                  ? `applications open for ${joinableIntakes.length} ${joinableIntakes.length === 1 ? 'intake' : 'intakes'}`
                  : 'the academy team'}{' '}
                beside you.
              </p>
            </div>

            <div className={styles.journeyGrid} data-reveal>
              {JOURNEY.map((step) => (
                <article key={step.kicker} className={`${styles.step} ${step.accent ? styles.stepAccent : ''}`}>
                  <span>{step.kicker}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <b>{step.footer}</b>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQs ─────────────────────────────────────────────────────── */}
        <section className={`${styles.wrap} ${styles.faq}`} id="faq" data-faq>
          <div className={styles.faqAside}>
            <p className={styles.label}>Before your first take</p>
            <h2 className={styles.display}>
              A few things
              <br />
              <em>to know.</em>
            </h2>
            <p className={styles.lede}>
              Everything below comes from the academy&apos;s own training records and application form. When a detail
              is set by the admissions team rather than the system, it says so.
            </p>
            <a href={whatsappEnquiry('Hello Spotlight Film Academy, I want to enquire about enrolment.')}>
              Ask us on WhatsApp ↗
            </a>
          </div>

          <div className={styles.faqList}>
            <details>
              <summary>
                Do I need film experience to apply? <span aria-hidden="true">+</span>
              </summary>
              <p>
                The application asks for your film or production experience, the career goal you are training toward,
                and — if you have it — a portfolio link or a sample of your work. Admissions reviews each application
                and guides you to the area that fits.
              </p>
            </details>

            <details>
              <summary>
                What does the training cost? <span aria-hidden="true">+</span>
              </summary>
              <p>
                Tuition is set per area of study and per format, and an application carries up to {maxAreas} areas, so
                the total is the sum of what you select. Alongside tuition there is an application fee of{' '}
                {settings?.registration_type === 'paid' ? formatNaira(settings.application_fee) : 'an amount confirmed by admissions'}
                , and the project costs listed above are not covered by tuition.
              </p>
              <p>Confirm the current amounts with admissions before you pay — they are managed by the academy team.</p>
            </details>

            <details>
              <summary>
                Which training formats are offered? <span aria-hidden="true">+</span>
              </summary>
              <ul>
                {pricingStructure.map((format) => (
                  <li key={format.key}>
                    {format.label}
                    {format.note ? ` — ${format.note}` : ''}
                  </li>
                ))}
              </ul>
              <p>
                The full-time format runs about a month and is the one priced with boarding for people coming from
                outside Lagos.
              </p>
            </details>

            <details>
              <summary>
                How long is the programme? <span aria-hidden="true">+</span>
              </summary>
              <p>
                It depends on the intake you join. Each one carries its own schedule and length, and the intakes
                published above run{' '}
                {programmeLengths.length > 0
                  ? `${programmeLengths.map((weeks) => `${weeks} weeks`).join(', ')}`
                  : 'lengths confirmed by admissions'}
                .
              </p>
            </details>

            <details>
              <summary>
                Where does training take place? <span aria-hidden="true">+</span>
              </summary>
              <p>
                {ACADEMY_CONTACT.address.join(', ')}. Ask admissions for directions and visiting arrangements before you
                travel.
              </p>
            </details>

            <details>
              <summary>
                How do I apply? <span aria-hidden="true">+</span>
              </summary>
              <p>
                The apply button opens the application right here, over this page. You choose an intake, then up
                to {maxAreas} areas of study and a format for each, and see what is charged before you commit. Sign
                in when you are ready to submit — it returns you here afterwards — and admissions reviews the
                application from there.
              </p>
            </details>

            <details>
              <summary>
                Is accommodation available? <span aria-hidden="true">+</span>
              </summary>
              <p>
                Three of the five formats are priced with boarding. Whether a bed is free for your dates is set by
                admissions, so ask them before you choose a format. Feeding is not included in any tuition amount.
              </p>
            </details>

            <details>
              <summary>
                What will I have at the end? <span aria-hidden="true">+</span>
              </summary>
              <p>
                {deliverables.join('. ')}.
              </p>
            </details>
          </div>
        </section>

        {/* ── Closing ──────────────────────────────────────────────────── */}
        <section className={styles.closing}>
          <div className={styles.wrap}>
            <p className={styles.eyebrow}>
              <span className={styles.liveDot} aria-hidden="true" /> Lights · camera · your future
            </p>
            <h2>
              See you
              <br />
              <em>on set.</em>
            </h2>
            <div className={styles.closingBottom}>
              <p>
                Applications for the academy open on this site once you have a Spotlight account. Still deciding which
                craft is yours? Talk to admissions first — it costs nothing.
              </p>
              <div className={styles.heroActions}>
                <ApplyLink className={`${styles.btn} ${styles.btnPrimary}`}>
                  Start an application <span aria-hidden="true">↗</span>
                </ApplyLink>
                <a
                  className={`${styles.btn} ${styles.btnOutline}`}
                  href={whatsappEnquiry('Hello Spotlight Film Academy, I would like help choosing an area of study.')}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  WhatsApp admissions <span aria-hidden="true">↗</span>
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.contact}>
          <div className={`${styles.wrap} ${styles.contactGrid}`}>
            <div>
              <h4>Come find us</h4>
              <p>
                {ACADEMY_CONTACT.address.map((line) => (
                  <span key={line}>
                    {line}
                    <br />
                  </span>
                ))}
              </p>
            </div>
            <div>
              <h4>Let&apos;s talk</h4>
              <a href={ACADEMY_CONTACT.phoneHref}>{ACADEMY_CONTACT.phoneDisplay}</a>
              <br />
              <a href={whatsappEnquiry('Hello Spotlight Film Academy, I want to enquire about enrolment.')} target="_blank" rel="noopener noreferrer">
                WhatsApp admissions ↗
              </a>
              <br />
              <Link href="/contact">Contact Spotlight <span aria-hidden="true">↗</span></Link>
            </div>
            <div>
              <h4>Follow the story</h4>
              {ACADEMY_CONTACT.socials.map((social) => (
                <span key={social.label}>
                  <a href={social.href} target="_blank" rel="noopener noreferrer">
                    {social.label} ↗
                  </a>
                  <br />
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>
      </AcademyApplyProvider>
    </Layout>
  );
}
