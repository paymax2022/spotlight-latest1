'use client';

import Layout from '@/components/layout/Layout';
import { useEffect, useRef, useState } from 'react';
import './sme-pitch.css';

const BANNERS = [
  {
    src: '/service-details/sme-pitch-contest/pitch-1.webp',
    alt: 'Illustrative Spotlight SME funding contest montage',
    caption: 'The pitch final',
  },
  {
    src: '/service-details/sme-pitch-contest/pitch-2.webp',
    alt: 'Illustrative montage of Lagos entrepreneurs preparing and presenting their pitches',
    caption: 'Three moments in the pitch room',
  },
  {
    src: '/service-details/sme-pitch-contest/pitch-3.webp',
    alt: 'Illustrative founder journey from workshop to investor meeting',
    caption: 'From workshop to investor meeting',
  },
];

const SECTIONS = [
  { href: '#process', label: 'The process' },
  { href: '#ecosystem', label: 'The ecosystem' },
  { href: '#readiness', label: 'Pitch checklist' },
];

const STEPS = [
  { n: '01', title: 'Apply', body: 'Submit your business profile and the problem you’re solving.' },
  { n: '02', title: 'Get screened', body: 'Reviewers assess eligibility, market fit and your evidence so far.' },
  { n: '03', title: 'Refine the pitch', body: 'Work on your story, numbers and funding ask with founder coaching.' },
  { n: '04', title: 'Pitch live', body: 'Present to a panel and answer questions about customers, execution and growth.' },
  { n: '05', title: 'Follow through', body: 'Use the feedback to prepare for introductions and any subsequent due diligence.' },
];

const BACKERS = [
  {
    n: '01 / EQUITY',
    title: 'Venture capital',
    body: 'For scalable businesses with a clear market, traction and a credible plan to grow.',
  },
  {
    n: '02 / EARLY CAPITAL',
    title: 'Angel investors',
    body: 'Early funding conversations and practical guidance from individual investors and operators.',
  },
  {
    n: '03 / DEVELOPMENT FINANCE',
    title: 'Bank of Industry',
    body: 'Development-finance pathways for eligible enterprises, subject to programme terms and credit assessment.',
    link: { href: 'https://www.boi.ng/', label: 'Explore BOI' },
  },
  {
    n: '04 / ENTERPRISE SUPPORT',
    title: 'SMEDAN',
    body: 'Business development, capacity building and guidance on enterprise support programmes.',
    link: { href: 'https://smedan.gov.ng/', label: 'Explore SMEDAN' },
  },
  {
    n: '05 / EXPORT READINESS',
    title: 'Nigerian Export Promotion Council',
    body: 'Export training and market-readiness resources for businesses exploring customers beyond Nigeria.',
    link: { href: 'https://nepc.gov.ng/', label: 'Explore NEPC' },
  },
  {
    n: '06 / POLICY & ACCESS',
    title: 'Federal enterprise agencies',
    body: 'Public-sector outreach can connect founders to relevant trade, industry and MSME programmes.',
  },
];

const CHECKLIST = [
  'I can explain the customer problem in one sentence.',
  'I can show traction, validation or a working prototype.',
  'I know how the business makes money.',
  'I have a specific funding ask and use of funds.',
  'I can name the milestone that funding would unlock.',
];

const FAQS = [
  {
    q: 'Who can apply?',
    a: 'Early and growth-stage founders may apply subject to the published criteria. Check the official entry page for current requirements.',
  },
  {
    q: 'Does winning guarantee funding?',
    a: 'Funding decisions are made by the relevant providers after their own review. The contest helps founders prepare, gain exposure and start conversations.',
  },
  {
    q: 'What should I include in my pitch?',
    a: 'Explain the problem, customer, business model, evidence of demand, funding ask and what you’ll achieve with it.',
  },
];

const AUTOADVANCE_MS = 6500;

export default function SmePitchContestPage() {
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [checked, setChecked] = useState<boolean[]>(() => CHECKLIST.map(() => false));
  const [stuck, setStuck] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);

  const readyCount = checked.filter(Boolean).length;

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotionChange = (event: MediaQueryListEvent) => setPaused(event.matches);
    setPaused(motion.matches);
    motion.addEventListener('change', onMotionChange);

    const onVisibility = () => setPageHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      motion.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (paused || engaged || pageHidden) return;
    const timer = setInterval(() => setSlide((s) => (s + 1) % BANNERS.length), AUTOADVANCE_MS);
    return () => clearInterval(timer);
  }, [paused, engaged, pageHidden]);

  // Layout gives #header-sticky its own scroll state; this mirrors the same
  // threshold so the spacer below appears in the frame the header turns fixed.
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 100);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const header = document.getElementById('header-sticky');
    const rail = railRef.current;
    if (!header || !rail) return;
    const sync = () => {
      const root = document.documentElement.style;
      root.setProperty('--sme-rail-top', `${header.offsetHeight}px`);
      root.setProperty('--sme-chrome-top', `${header.offsetHeight + rail.offsetHeight}px`);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(header);
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  function stepBy(delta: number) {
    setPaused(true);
    setSlide((s) => (s + delta + BANNERS.length) % BANNERS.length);
  }

  function toggleChecked(index: number) {
    setChecked((prev) => prev.map((value, i) => (i === index ? !value : value)));
  }

  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={false}
      breadcrumbTitle={null}
      breadcrumbClassName={undefined}
      breadcrumbPadding={undefined}
    >
      <div className="smePitch">
        <a className="skip" href="#main">
          Skip to content
        </a>
        {/* main.css makes #header-sticky position:fixed once scrolled, which drops
            it out of flow and yanks the page up by its own height mid-scroll —
            enough to hide the top of any section an anchor jump lands on. */}
        {stuck && <div className="header-spacer" aria-hidden="true" />}

        <div className="section-rail" ref={railRef}>
          <div className="wrap">
            <nav aria-label="Page sections">
              {SECTIONS.map((section) => (
                <a key={section.href} href={section.href}>
                  {section.label}
                </a>
              ))}
            </nav>
            <a className="button outlined" href="/apply/sme-pitch-contest">
              Apply to pitch <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>

        <main id="main">
          <section className="hero">
            <div className="wrap hero-title">
              <div>
                <p className="eyebrow">SPOTLIGHT / THE FOUNDER EDITION</p>
                <h1>
                  Build it. Pitch it.
                  <br />
                  <em>Make your next move.</em>
                </h1>
              </div>
              <div className="hero-side">
                <p>
                  For Nigerian founders ready to show what they’ve built, sharpen their case for growth
                  and get in front of people who can help.
                </p>
                <a className="button primary" href="/apply/sme-pitch-contest">
                  Apply to pitch <span aria-hidden="true">↗</span>
                </a>
              </div>
            </div>

            <div
              className="wrap reel"
              role="region"
              aria-roledescription="carousel"
              aria-label="SME pitch campaign banners"
              onMouseEnter={() => setEngaged(true)}
              onMouseLeave={() => setEngaged(false)}
              onFocusCapture={() => setEngaged(true)}
              onBlurCapture={() => setEngaged(false)}
            >
              <div className="reel-window">
                <div className="reel-track" style={{ transform: `translateX(-${slide * 100}%)` }}>
                  {BANNERS.map((banner, i) => (
                    <figure key={banner.src} inert={i !== slide} aria-hidden={i !== slide}>
                      <img
                        src={banner.src}
                        alt={banner.alt}
                        width={1774}
                        height={887}
                        fetchPriority={i === 0 ? 'high' : 'auto'}
                        decoding={i === 0 ? 'sync' : 'async'}
                      />
                    </figure>
                  ))}
                </div>
              </div>
              <div className="reel-controls">
                <p>
                  <span className="reel-index" aria-hidden="true">
                    {String(slide + 1).padStart(2, '0')} / {String(BANNERS.length).padStart(2, '0')}
                  </span>{' '}
                  <span className="reel-caption" aria-live={paused ? 'polite' : 'off'}>
                    {BANNERS[slide].caption}
                  </span>{' '}
                  <small> / CAMPAIGN ARTWORK</small>
                </p>
                <div className="reel-buttons">
                  <button type="button" aria-label="Previous banner" onClick={() => stepBy(-1)}>
                    ←
                  </button>
                  <button type="button" aria-label="Next banner" onClick={() => stepBy(1)}>
                    →
                  </button>
                  <button type="button" onClick={() => setPaused((p) => !p)}>
                    {paused ? 'Play' : 'Pause'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="wrap intro">
            <div>
              <p className="eyebrow">01 / THE CONTEST</p>
              <h2>
                The room where
                <br />
                your business gets heard.
              </h2>
            </div>
            <div>
              <p>
                Spotlight brings early and growth-stage founders through business screening, pitch coaching
                and live evaluation. Selected ventures can gain public visibility, practical feedback and
                introductions to potential backers.
              </p>
              <p>Check the official application for the current cohort’s eligibility, timetable and submission requirements.</p>
            </div>
          </section>

          <section className="process" id="process">
            <div className="wrap">
              <p className="eyebrow">02 / THE PROCESS</p>
              <h2>From application to follow-up.</h2>
              <p className="lead">Each stage asks a different question about your business.</p>
              <ol className="route">
                {STEPS.map((step) => (
                  <li key={step.n}>
                    <span>{step.n}</span>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="wrap ecosystem" id="ecosystem">
            <p className="eyebrow">03 / THE FUNDING ECOSYSTEM</p>
            <h2>
              Different capital.
              <br />
              Different conversations.
            </h2>
            <p className="lead">
              A proposed stakeholder mix for the contest. Each group can support a different next step.
            </p>
            <div className="matrix">
              {BACKERS.map((backer) => (
                <article key={backer.n}>
                  <span>{backer.n}</span>
                  <h3>{backer.title}</h3>
                  <p>{backer.body}</p>
                  {backer.link && (
                    <a href={backer.link.href} target="_blank" rel="noopener noreferrer">
                      {backer.link.label} <span aria-hidden="true">↗</span>
                    </a>
                  )}
                </article>
              ))}
            </div>
            <p className="fine">
              Named institutions are prospective stakeholders. Participation and any funding offers are
              subject to confirmation and the relevant provider’s review.
            </p>
          </section>

          <section className="readiness" id="readiness">
            <div className="wrap ready-grid">
              <div>
                <p className="eyebrow">04 / PITCH PREPARATION</p>
                <h2>
                  What will you bring
                  <br />
                  into the room?
                </h2>
                <p className="lead">
                  Use this checklist to prepare for a pitch or coaching session. Your selections stay on
                  this page.
                </p>
                <p className="progress-copy" aria-live="polite">
                  {readyCount} of {CHECKLIST.length} ready
                </p>
                <progress
                  className="progress"
                  value={readyCount}
                  max={CHECKLIST.length}
                  aria-label="Pitch preparation checklist progress"
                />
              </div>
              <fieldset>
                <legend>Founder checklist</legend>
                {CHECKLIST.map((item, i) => (
                  <label key={item}>
                    <input
                      type="checkbox"
                      checked={checked[i]}
                      onChange={() => toggleChecked(i)}
                    />
                    {item}
                  </label>
                ))}
              </fieldset>
            </div>
          </section>

          <section className="wrap end" id="apply">
            <div>
              <p className="eyebrow">05 / TAKE THE NEXT STEP</p>
              <h2>Ready for the room?</h2>
              <div className="actions">
                <a className="button primary" href="/apply/sme-pitch-contest">
                  Open official application <span aria-hidden="true">↗</span>
                </a>
                <a className="button outlined" href="/sponsors-partners">
                  Partner with Spotlight <span aria-hidden="true">↗</span>
                </a>
              </div>
            </div>
            <div className="faq">
              {FAQS.map((faq) => (
                <details key={faq.q}>
                  <summary>{faq.q}</summary>
                  <p>{faq.a}</p>
                </details>
              ))}
            </div>
          </section>
        </main>
      </div>
    </Layout>
  );
}
