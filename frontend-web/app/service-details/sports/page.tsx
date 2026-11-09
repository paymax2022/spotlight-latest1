'use client';

import Layout from '@/components/layout/Layout';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import './sports.css';

const slides = [
  {
    src: '/service-details/sports/futsal-duel.webp',
    alt: 'Three views of players attacking, defending and saving a shot on an indoor court.',
    label: 'The duel',
    width: 1774,
    height: 887,
    fetchPriority: 'high' as const,
  },
  {
    src: '/service-details/sports/futsal-women.webp',
    alt: 'Women\u2019s futsal team in a huddle, driving toward goal and celebrating together.',
    label: 'Women on court',
    width: 1774,
    height: 887,
  },
  {
    src: '/service-details/sports/futsal-finals.webp',
    alt: 'A coach briefs the team, players contest the ball and the captain lifts a trophy.',
    label: 'Road to the final',
    width: 1774,
    height: 887,
  },
];

export default function SportsPage() {
  const [openStage, setOpenStage] = useState<string>('entry-step');
  const stageRefs = useRef<Map<string, HTMLDetailsElement>>(new Map());

  const [currentSlide, setCurrentSlide] = useState(0);
  const [playing, setPlaying] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const carouselRef = useRef<HTMLElement>(null);
  const reducedMotion = useRef(false);

  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion.current = mq.matches;
    if (mq.matches) setPlaying(false);
    const handler = () => {
      reducedMotion.current = mq.matches;
      if (mq.matches) setPlaying(false);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const schedule = useCallback(() => {
    clearTimeout(timerRef.current);
    if (playing && !document.hidden) {
      timerRef.current = setTimeout(() => {
        setCurrentSlide((prev) => (prev + 1) % slides.length);
      }, 6550);
    }
  }, [playing]);

  useEffect(() => {
    schedule();
    return () => clearTimeout(timerRef.current);
  }, [schedule, currentSlide]);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash && stageRefs.current.has(hash)) {
        setOpenStage(hash);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  function handleStageClick(stageId: string) {
    setOpenStage(stageId);
    window.location.hash = `#${stageId}`;
  }

  function selectSlide(index: number) {
    setPlaying(false);
    setCurrentSlide((index + slides.length) % slides.length);
  }

  function handleCarouselMouseEnter() {
    if (carouselRef.current?.matches(':hover')) {
      clearTimeout(timerRef.current);
    }
  }

  function handleCarouselMouseLeave() {
    schedule();
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      clearTimeout(timerRef.current);
    } else {
      schedule();
    }
  }

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={false}
      breadcrumbTitle={null}
      breadcrumbClassName={undefined}
      breadcrumbPadding={undefined}
    >
      <div className="sports">
        <main id="main">
        <section className="hero">
          <div className="wrap cover">
            <div className="cover-copy">
              <p className="eyebrow">SPOTLIGHT SPORTS / INDOOR FOOTBALL</p>
              <h1>
                Own your court.
                <br />
                <em>Represent your state.</em>
              </h1>
              <p className="lead">
                Build your squad, compete in your state and earn a shot at Spotlight&apos;s national indoor football
                championship.
              </p>
              <div className="actions">
                <Link className="button primary" href="#team-desk">
                  Explore team entry <span aria-hidden="true">&rarr;</span>
                </Link>
                <Link className="button ghost" href="#route">
                  See the competition route
                </Link>
              </div>
            </div>

            <section
              className="hero-carousel"
              ref={carouselRef}
              aria-label="Indoor football campaign banners"
              aria-roledescription="carousel"
              onMouseEnter={handleCarouselMouseEnter}
              onMouseLeave={handleCarouselMouseLeave}
            >
              <div className="carousel-window">
                <div
                  className="carousel-track"
                  style={{ transform: `translateX(-${currentSlide * 100}%)` }}
                >
                  {slides.map((slide, i) => (
                    <figure
                      key={slide.src}
                      className="hero-slide"
                      aria-label={`${i + 1} of ${slides.length} \u2014 ${slide.label}`}
                      aria-hidden={i !== currentSlide}
                    >
                      <img
                        src={slide.src}
                        alt={slide.alt}
                        width={slide.width}
                        height={slide.height}
                        fetchPriority={slide.fetchPriority}
                        decoding={i === 0 ? 'sync' : 'async'}
                      />
                    </figure>
                  ))}
                </div>
              </div>
              <div className="carousel-bar">
                <div className="carousel-choices" aria-label="Choose a banner">
                  {slides.map((slide, i) => (
                    <button
                      key={slide.src}
                      type="button"
                      aria-pressed={i === currentSlide}
                      onClick={() => selectSlide(i)}
                    >
                      <span>{String(i + 1).padStart(2, '0')}</span> {slide.label}
                    </button>
                  ))}
                </div>
                <div className="carousel-controls">
                  <button
                    type="button"
                    aria-label="Previous banner"
                    onClick={() => selectSlide(currentSlide - 1)}
                  >
                    &larr;
                  </button>
                  <button type="button" onClick={() => setPlaying((p) => !p)}>
                    {playing ? 'Pause' : 'Play'}
                  </button>
                  <button
                    type="button"
                    aria-label="Next banner"
                    onClick={() => selectSlide(currentSlide + 1)}
                  >
                    &rarr;
                  </button>
                </div>
              </div>
              <p className="carousel-caption">
                Illustrative campaign imagery{' '}
                <span className="sr-only" role="status">
                  {slides[currentSlide]
                    ? `${currentSlide + 1} of ${slides.length} \u2014 ${slides[currentSlide].label}`
                    : ''}
                </span>
              </p>
            </section>
          </div>
        </section>

        <div className="scorebar">
          <div className="wrap scoregrid">
            <div>
              <b>01</b>
              <span>Squad entry</span>
            </div>
            <div>
              <b>02</b>
              <span>State qualifiers</span>
            </div>
            <div>
              <b>03</b>
              <span>National championship</span>
            </div>
          </div>
        </div>

        <section id="route" className="wrap pad">
          <p className="eyebrow">01 / COMPETITION ROUTE</p>
          <h2>Three stages. One national title.</h2>
          <p className="section-copy">Follow your squad&apos;s route from entry to the national court.</p>
          <div className="route-layout">
            <div className="pitch">
              <svg viewBox="0 0 580 330" aria-hidden="true">
                <defs>
                  <pattern id="grid" width="22" height="22" patternUnits="userSpaceOnUse">
                    <path d="M22 0H0v22" fill="none" stroke="#ffffff12" />
                  </pattern>
                </defs>
                <rect
                  x="17"
                  y="19"
                  width="546"
                  height="292"
                  rx="7"
                  fill="url(#grid)"
                  stroke="#c9a4d7"
                  strokeOpacity=".7"
                />
                <g fill="none" stroke="#c9a4d7" strokeOpacity=".7">
                  <path d="M290 19v292M17 127h-9v76h9m546-76h9v76h-9M17 95h39a70 70 0 0 1 0 140H17m546-140h-39a70 70 0 0 0 0 140h39" />
                  <circle cx="290" cy="165" r="47" />
                </g>
                <path
                  d="m105 225 185-60 182-61"
                  fill="none"
                  stroke="#ffb684"
                  strokeDasharray="6 6"
                  strokeWidth="2"
                />
              </svg>
              <nav aria-label="Competition stages">
                <button
                  type="button"
                  className="spot spot-one"
                  onClick={() => handleStageClick('entry-step')}
                  aria-label="Stage 1, squad entry"
                  aria-current={openStage === 'entry-step' ? 'step' : undefined}
                >
                  01
                </button>
                <button
                  type="button"
                  className="spot spot-two"
                  onClick={() => handleStageClick('state-step')}
                  aria-label="Stage 2, state qualifiers"
                  aria-current={openStage === 'state-step' ? 'step' : undefined}
                >
                  02
                </button>
                <button
                  type="button"
                  className="spot spot-three"
                  onClick={() => handleStageClick('national-step')}
                  aria-label="Stage 3, national championship"
                  aria-current={openStage === 'national-step' ? 'step' : undefined}
                >
                  03
                </button>
              </nav>
            </div>
            <div className="route-steps">
              <details
                id="entry-step"
                name="stages"
                open={openStage === 'entry-step'}
                ref={(el) => {
                  if (el) stageRefs.current.set('entry-step', el);
                }}
                onToggle={(e) => {
                  if ((e.target as HTMLDetailsElement).open) setOpenStage('entry-step');
                }}
              >
                <summary>
                  <span>01</span> Register your squad
                </summary>
                <p>
                  Choose a team captain and prepare your player roster and contact details. Confirm the published
                  eligibility, roster size and registration instructions before entering.
                </p>
              </details>
              <details
                id="state-step"
                name="stages"
                open={openStage === 'state-step'}
                ref={(el) => {
                  if (el) stageRefs.current.set('state-step', el);
                }}
                onToggle={(e) => {
                  if ((e.target as HTMLDetailsElement).open) setOpenStage('state-step');
                }}
              >
                <summary>
                  <span>02</span> Compete in your state
                </summary>
                <p>
                  Eligible squads play in their state qualifiers. Check the fixtures, venues and advancement rules
                  announced for your state.
                </p>
              </details>
              <details
                id="national-step"
                name="stages"
                open={openStage === 'national-step'}
                ref={(el) => {
                  if (el) stageRefs.current.set('national-step', el);
                }}
                onToggle={(e) => {
                  if ((e.target as HTMLDetailsElement).open) setOpenStage('national-step');
                }}
              >
                <summary>
                  <span>03</span> Play for the national title
                </summary>
                <p>
                  Qualifying squads represent their states at the national championship. The final fixture schedule and
                  tournament format will follow the official competition rules.
                </p>
              </details>
            </div>
          </div>
        </section>

        <section className="paper" id="rewards">
          <div className="wrap pad">
            <p className="eyebrow">02 / PRIZES AND PLAYER OPPORTUNITIES</p>
            <h2>What&apos;s at stake.</h2>
            <div className="reward-grid">
              <article>
                <span>01 / AWARDS</span>
                <h3>Team prizes and individual honours</h3>
                <p>
                  The award concept includes champion and runner-up prizes, plus recognition for standout players. Prize
                  amounts and award categories are subject to official confirmation.
                </p>
              </article>
              <article>
                <span>02 / CLUB PATHWAYS</span>
                <h3>Foreign club placement opportunities</h3>
                <p>
                  Selected players could be introduced to scouts or clubs abroad through verified player profiles and
                  match footage. Trials and placements depend on club interest, assessment and eligibility.
                </p>
              </article>
              <article>
                <span>03 / AMBASSADORS</span>
                <h3>Brand ambassador opportunities</h3>
                <p>
                  Standout players may be considered for campaigns with sports and lifestyle brands, subject to partner
                  selection and a separate agreement.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="wrap pad profile">
          <figure>
            <img
              src="/service-details/sports/team.webp"
              alt="Futsal players gathered as a team"
              loading="lazy"
              decoding="async"
              width={1536}
              height={1024}
            />
            <figcaption>
              2025 CAF Women&apos;s Futsal Africa Cup of Nations ·{' '}
              <a href="https://commons.wikimedia.org/wiki/File:Morocco_women%27s_national_futsal_team_(WAFCON_Futsal_2025).jpg">
                Reda benkhadra / Wikimedia Commons
              </a>{' '}
              · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a> · resized
            </figcaption>
          </figure>
          <div>
            <p className="eyebrow">03 / PLAYER SHOWCASE</p>
            <h2>Give scouts something to assess.</h2>
            <p className="section-copy">
              A proposed player profile brings the essentials together for selected talent. Prepare your position,
              verified match footage and coach reference so scouts can see how you play under pressure.
            </p>
            <ul>
              <li>Position and squad role</li>
              <li>Match footage with timecodes</li>
              <li>Coach or team contact</li>
            </ul>
          </div>
        </section>

        <section className="sponsorship" id="sponsorship">
          <div className="wrap pad sponsor-layout">
            <div>
              <p className="eyebrow">04 / SPONSORSHIP</p>
              <h2>Brands in discussion.</h2>
              <p>Brand names and logos will appear here once Spotlight approves them for publication.</p>
              <Link className="button primary" href="/contact">
                Discuss sponsorship with Spotlight <span aria-hidden="true">&rarr;</span>
              </Link>
            </div>
            <div className="sponsor-options">
            <p className="eyebrow">PARTNERSHIP OPPORTUNITIES</p>
              <ul>
                <li>
                  <b>01</b> Tournament and matchday sponsorship
                </li>
                <li>
                  <b>02</b> Kit, equipment and court branding
                </li>
                <li>
                  <b>03</b> Player ambassador and content campaigns
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="closing" id="team-desk">
          <div className="wrap pad">
            <p className="eyebrow">05 / TEAM DESK</p>
            <h2>Get your squad ready.</h2>
            <p>
              Nominate a captain, confirm your home state and have a draft roster ready. Follow Spotlight&apos;s
              application instructions when your competition window opens.
            </p>
            <div className="actions">
              <Link className="button primary" href="/apply">
                Open Spotlight applications <span aria-hidden="true">&rarr;</span>
              </Link>
              <Link className="button ghost" href="/contact">
                Contact Spotlight
              </Link>
            </div>
            <div className="faq">
              <details>
                <summary>When will fixtures and venues be available?</summary>
                <p>Use Spotlight&apos;s official updates for confirmed fixtures, host venues and registration deadlines.</p>
              </details>
              <details>
                <summary>Do we need a complete squad before applying?</summary>
                <p>
                  Prepare a provisional roster and check the published minimum, maximum and eligibility rules for your
                  round.
                </p>
              </details>
            </div>
          </div>
        </section>
        </main>
      </div>
    </Layout>
  );
}
