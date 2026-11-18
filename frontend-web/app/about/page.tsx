'use client';

import Layout from '@/components/layout/Layout';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import './about.css';

const CAPTIONS = [
  'Four paths to victory',
  'Nigerian ambition in motion',
  'School STEM & youth hackathon',
];

const SLIDES = [
  { src: 'campaign-1', alt: 'Illustrative montage of a singer, school STEM team, founder and indoor football players' },
  { src: 'campaign-2', alt: 'Illustrative montage of a vocalist, robotics team, product pitch and futsal match' },
  { src: 'campaign-3', alt: 'Illustrative scenes of school STEM projects, youth hackathon teams and an awards presentation' },
];

const CONTESTS = [
  {
    id: 'reality',
    name: 'Reality TV',
    round: 'BOOTCAMP / SAMPLE ROUND',
    open: true,
    description: 'Discover the sample performers on the bootcamp stage.',
    people: [
      ['amara', 'Amara Vale', 'Soul vocalist'],
      ['tobi', 'Tobi North', 'Comedy'],
      ['sade', 'Sade Crest', 'Screen acting'],
    ],
  },
  {
    id: 'mic',
    name: 'Open Mic',
    round: 'MONTHLY SHOWCASE / SAMPLE ROUND',
    open: true,
    description: 'Explore the sample lineup of emerging artists.',
    people: [
      ['naya', 'Naya Bloom', 'Afrosoul'],
      ['kade', 'Kade Metro', 'Afropop'],
      ['zuri', 'Zuri Echo', 'Alternative R&B'],
    ],
  },
  {
    id: 'stem',
    name: 'STEM & Tech',
    round: 'NATIONAL SHOWCASE / SAMPLE ROUND',
    open: false,
    description: 'Browse the sample innovators. Voting is closed for this round.',
    people: [
      ['delta', 'Team Delta Seed', 'Agritech'],
      ['spark', 'Team Spark Bridge', 'Energy'],
      ['orbit', 'Team Orbit Lab', 'Robotics'],
    ],
  },
  {
    id: 'sme',
    name: 'SME Pitch',
    round: 'FOUNDER SHOWCASE / SAMPLE ROUND',
    open: false,
    description: 'Explore the sample founders. Voting is closed for this round.',
    people: [
      ['terra', 'Terra Loom', 'Circular manufacturing'],
      ['market', 'Market Relay', 'Retail logistics'],
      ['hive', 'Hive Works', 'Business tools'],
    ],
  },
  {
    id: 'football',
    name: 'Indoor Football',
    round: 'STATE SHOWCASE / SAMPLE ROUND',
    open: false,
    description: 'Explore the sample squads. Voting is closed for this round.',
    people: [
      ['crest', 'Crest City', 'Indoor football'],
      ['rivers', 'River Five', 'Indoor football'],
      ['pulse', 'Metro Pulse', 'Indoor football'],
    ],
  },
];

const VOTE_KEY = 'spotlight-voting-demo-v2';
const COOLDOWN = 24 * 60 * 60 * 1000;
const PRICE = 100;

function formatNaira(n: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(n);
}

function getVotes(): Record<string, { freeAt: number; counts: Record<string, number> }> {
  try {
    const data = JSON.parse(localStorage.getItem(VOTE_KEY) || 'null');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function saveVotes(data: Record<string, { freeAt: number; counts: Record<string, number> }>) {
  localStorage.setItem(VOTE_KEY, JSON.stringify(data));
}

function remaining(contestId: string): number {
  const votes = getVotes();
  const record = votes[contestId];
  if (!record) return 0;
  return Math.max(0, record.freeAt + COOLDOWN - Date.now());
}

function clock(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
}

function Reel() {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const showBanner = useCallback(
    (index: number) => {
      const next = (index + SLIDES.length) % SLIDES.length;
      setCurrent(next);
      if (trackRef.current) {
        trackRef.current.style.transform = `translateX(${-100 * next}%)`;
      }
    },
    [],
  );

  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) setPaused(true);

    const schedule = () => {
      clearInterval(timerRef.current);
      if (!paused && !document.hidden) {
        timerRef.current = setInterval(() => showBanner(current + 1), 6500);
      }
    };

    schedule();
    return () => clearInterval(timerRef.current);
  }, [paused, current, showBanner]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) clearInterval(timerRef.current);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return (
    <div className="reel" role="region" aria-roledescription="carousel" aria-label="Spotlight programme banners">
      <div className="reel-window">
        <div className="reel-track" ref={trackRef}>
          {SLIDES.map((slide, i) => (
            <figure key={slide.src} inert={i !== current} aria-hidden={i !== current}>
              <img
                src={`/assets/img/about/${slide.src}.webp`}
                alt={slide.alt}
                width={1774}
                height={887}
                {...(i === 0 ? { fetchPriority: 'high' } : { loading: 'lazy' })}
              />
            </figure>
          ))}
        </div>
      </div>
      <div className="reel-controls">
        <div>
          <span className="reel-index" aria-hidden="true">
            {String(current + 1).padStart(2, '0')} / {String(SLIDES.length).padStart(2, '0')}
          </span>{' '}
          <span id="reel-caption">{CAPTIONS[current]}</span>
          <small> / CAMPAIGN ARTWORK</small>
        </div>
        <div className="reel-buttons">
          <button type="button" onClick={() => showBanner(current - 1)} aria-label="Previous banner">
            ←
          </button>
          <button type="button" onClick={() => showBanner(current + 1)} aria-label="Next banner">
            →
          </button>
          <button type="button" onClick={() => setPaused(!paused)}>
            {paused ? 'Play' : 'Pause'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Ballot() {
  const [activeId, setActiveId] = useState(CONTESTS[0].id);
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<{ contest: (typeof CONTESTS)[0]; id: string; name: string } | null>(null);
  const [mode, setMode] = useState<'free' | 'paid'>('free');
  const [quantity, setQuantity] = useState(1);
  const [packageVal, setPackageVal] = useState('custom');
  const [reviewError, setReviewError] = useState('');
  const [tick, setTick] = useState(0);

  const active = CONTESTS.find((c) => c.id === activeId) || CONTESTS[0];
  const wait = remaining(active.id);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const query = search.trim().toLowerCase();
  const visible = active.people.filter(([, name, talent]) => (name + ' ' + talent).toLowerCase().includes(query));
  const votes = getVotes();
  const record = votes[active.id];

  const choose = (contest: (typeof CONTESTS)[0]) => {
    setActiveId(contest.id);
    setSearch('');
    setFeedback('');
  };

  const openBallot = (ballot: { contest: (typeof CONTESTS)[0]; id: string; name: string }, paidOnly: boolean) => {
    setSelected(ballot);
    setMode(paidOnly || remaining(ballot.contest.id) > 0 ? 'paid' : 'free');
    setQuantity(1);
    setPackageVal('custom');
    setReviewError('');
    setDialogOpen(true);
  };

  const submitVote = () => {
    if (!selected) return;
    const isPaid = mode === 'paid';
    const count = isPaid ? quantity : 1;
    if (!selected.contest.open || !Number.isSafeInteger(count) || count < 1 || count > 500) return;

    const data = getVotes();
    const rec = data[selected.contest.id] || { freeAt: 0, counts: {} };
    const now = Date.now();
    if (!isPaid && rec.freeAt + COOLDOWN > now) {
      setReviewError('Your free vote is still on cooldown.');
      return;
    }
    if (!isPaid) rec.freeAt = now;
    rec.counts[selected.id] = (rec.counts[selected.id] || 0) + count;
    data[selected.contest.id] = rec;
    saveVotes(data);

    setDialogOpen(false);
    setFeedback(count + (count === 1 ? ' demo vote' : ' demo votes') + ' recorded for ' + selected.name + (isPaid ? ' after simulated payment.' : '.'));
    setTick((t) => t + 1);
  };

  const validCount = Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 500;
  const totalPrice = mode === 'paid' ? (validCount ? formatNaira(quantity * PRICE) : '—') : 'Free';
  const totalLabel = validCount ? quantity + (quantity === 1 ? ' vote' : ' votes') : 'Enter 1–500 votes';

  return (
    <section className="wrap ballot" id="ballot">
      <div className="section-head">
        <div>
          <p className="k">
            <i /> 05 / THE CONTEST FLOOR
          </p>
          <h2>Meet the contenders.</h2>
        </div>
        <span className="preview">DEMO BALLOT</span>
      </div>
      <p className="notice">
        Explore sample lineups and try voting. For published contestants and live rounds, visit the{' '}
        <a href="https://www.spotlightng.com/talent-vault">official Talent Vault ↗</a>.
      </p>
      <div className="contest-picker" role="group" aria-label="Choose a contest">
        {CONTESTS.map((contest, i) => (
          <button
            key={contest.id}
            type="button"
            className="contest"
            aria-pressed={contest.id === activeId}
            onClick={() => choose(contest)}
          >
            <span className="number">0{i + 1}</span>
            <strong>{contest.name}</strong>
            <span className="state">{contest.open ? 'Demo voting open' : 'Demo voting closed'}</span>
          </button>
        ))}
      </div>
      <div className="lineup">
        <div className="lineup-head">
          <div>
            <p className="k">{active.round}</p>
            <h3>{active.name}</h3>
            <p>{active.description}</p>
          </div>
          <label>
            Find a contestant
            <input type="search" placeholder="Search this lineup" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        <div className="cards">
          {visible.map(([id, name, talent]) => {
            const initials = name
              .split(' ')
              .slice(-2)
              .map((w) => w[0])
              .join('');
            const toneIdx = active.people.findIndex((p) => p[0] === id);
            const count = record?.counts?.[id] || 0;
            const canVote = active.open && wait === 0;
            return (
              <article key={id} className="card">
                <div className={`monogram tone-${(toneIdx % 2) + 1}`} aria-hidden="true">
                  {initials}
                </div>
                <div className="card-copy">
                  <p className="discipline">{talent}</p>
                  <h4>{name}</h4>
                  {count > 0 && <p className="local-count">{count} demo vote{count === 1 ? '' : 's'} cast</p>}
                  <div className="card-actions">
                    <button
                      type="button"
                      className="button card-vote"
                      disabled={!canVote}
                      onClick={() => openBallot({ contest: active, id, name }, false)}
                      aria-label={`Vote · ${name}`}
                    >
                      {!active.open ? 'Voting closed' : wait > 0 ? `Free vote in ${clock(wait)}` : 'Vote'}
                    </button>
                    <button
                      type="button"
                      className="button card-vote paid-vote"
                      hidden={!active.open || wait === 0}
                      onClick={() => openBallot({ contest: active, id, name }, true)}
                      aria-label={`Buy votes · ${name}`}
                    >
                      Buy votes
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {visible.length === 0 && <p hidden={false}>No contestants match your search.</p>}
        <p className="feedback" role="status">
          {feedback}
        </p>
      </div>
      {dialogOpen && selected && (
        <dialog open>
          <form method="dialog" style={{ position: 'absolute', top: 9, right: 9 }}>
            <button aria-label="Close vote review" onClick={() => setDialogOpen(false)}>
              ×
            </button>
          </form>
          <div className="vote-heading">
            <p className="k">SPOTLIGHT / DEMO BALLOT</p>
            <h2>Cast your vote.</h2>
            <p>
              <strong>{selected.name}</strong> <span aria-hidden="true">·</span> <span>{selected.contest.name}</span>
            </p>
          </div>
          <fieldset className="vote-modes">
            <legend className="sr-only">Choose a voting method</legend>
            <label>
              <input type="radio" name="mode" value="free" checked={mode === 'free'} onChange={() => setMode('free')} disabled={wait > 0} />
              <span>
                <strong>Free vote</strong>
                <small>1 vote every 24 hours</small>
              </span>
            </label>
            <label>
              <input type="radio" name="mode" value="paid" checked={mode === 'paid'} onChange={() => setMode('paid')} />
              <span>
                <strong>Paid votes</strong>
                <small>Custom quantity or package</small>
              </span>
            </label>
          </fieldset>
          <p className="dialog-note">{mode === 'free' ? (wait ? `Next free vote in ${clock(wait)}.` : 'One free vote is available for this contest.') : 'Sample pricing for this preview.'}</p>
          {mode === 'paid' && (
            <div id="paid-options">
              <label>
                Voting package
                <select value={packageVal} onChange={(e) => { setPackageVal(e.target.value); if (e.target.value !== 'custom') setQuantity(Number(e.target.value)); }}>
                  <option value="custom">Custom quantity</option>
                  <option value="10">10 votes · ₦1,000</option>
                  <option value="25">25 votes · ₦2,500</option>
                  <option value="50">50 votes · ₦5,000</option>
                </select>
              </label>
              <label>
                Number of votes
                <input type="number" inputMode="numeric" value={quantity} min={1} max={500} step={1} onChange={(e) => { setQuantity(Number(e.target.value)); setPackageVal('custom'); }} />
              </label>
            </div>
          )}
          <div className="vote-total">
            <span>
              <small>{totalLabel}</small>
              <strong>{totalPrice}</strong>
            </span>
            <button className="button primary" onClick={submitVote} disabled={!validCount || (mode === 'free' && wait > 0)}>
              {mode === 'paid' ? 'Simulate payment & vote' : 'Cast free vote'}
            </button>
          </div>
          <p className="dialog-note">Demo only. Votes are stored in this browser and no payment is taken.</p>
          {reviewError && <p id="review-error" role="status">{reviewError}</p>}
        </dialog>
      )}
    </section>
  );
}

export default function AboutPage() {
  return (
    <Layout headerStyle={1} footerStyle={2} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <div className="about-page">
        <main id="main">
          <section className="opening" aria-labelledby="page-title">
            <div className="wrap marquee">
              <p className="k">
                <i /> ABOUT SPOTLIGHT / SEASON 2
              </p>
              <h1 id="page-title">
                The search is <em>on.</em>
              </h1>
              <p>Spotlight discovers and develops Nigerian talent across entertainment, technology, enterprise and sport. Season 2 takes that search across the country.</p>
              <a className="button primary" href="#auditions">
                See the audition route ↓
              </a>
            </div>
            <div className="wrap">
              <Reel />
            </div>
          </section>

          <section id="auditions" className="wrap audition">
            <div className="intro">
              <p className="k">
                <i /> 01 / NATIONWIDE AUDITIONS
              </p>
              <h2>
                From your state
                <br />
                to the main stage.
              </h2>
              <p>Season 2 starts with local auditions. Selected entertainment contestants go on to the mansion for coaching, tasks, performances and public voting where the round allows it.</p>
              <a className="button primary" href="https://www.spotlightng.com/season-2">
                Season 2 registration & updates ↗
              </a>
            </div>
            <div>
              <dl className="metrics">
                <div>
                  <dt>20</dt>
                  <dd>States in the campaign plan</dd>
                </div>
                <div>
                  <dt>60</dt>
                  <dd>Contestants in the reality TV format</dd>
                </div>
                <div>
                  <dt>60</dt>
                  <dd>Days in the mansion format</dd>
                </div>
              </dl>
              <ol className="route">
                <li>Register</li>
                <li>State auditions</li>
                <li>Shortlisting</li>
                <li>Bootcamp</li>
                <li>Grand finale</li>
              </ol>
              <p className="fine">Campaign format from Spotlight&apos;s Season 2 materials. Check the Season 2 page for dates, locations and entry details.</p>
            </div>
          </section>

          <section id="reach" className="reach">
            <div className="wrap">
              <p className="k">
                <i /> 02 / AUDIENCE REACH
              </p>
              <h2>Who each segment can reach.</h2>
              <p className="deck">The planned audiences, routes to reach them, and measures to track. Published audience targets by segment are pending.</p>
              <div className="reach-table">
                <table>
                  <thead>
                    <tr>
                      <th>Segment</th>
                      <th>Expected audience</th>
                      <th>Distribution</th>
                      <th>What to measure</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Entertainment</th>
                      <td>Music, acting and comedy fans</td>
                      <td>Audition clips, reality TV and creator recaps</td>
                      <td>Unique viewers by platform</td>
                    </tr>
                    <tr>
                      <th scope="row">STEM & Tech</th>
                      <td>Students, educators and young builders</td>
                      <td>School networks, tech communities and demo highlights</td>
                      <td>Schools reached and unique viewers</td>
                    </tr>
                    <tr>
                      <th scope="row">SME Pitch</th>
                      <td>Founders, investors and business audiences</td>
                      <td>Founder networks, pitch clips and business media</td>
                      <td>Founders reached and unique viewers</td>
                    </tr>
                    <tr>
                      <th scope="row">Indoor Football</th>
                      <td>Players, clubs and grassroots supporters</td>
                      <td>Local football networks, fixtures and match highlights</td>
                      <td>Clubs reached and unique viewers</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section id="network" className="wrap network">
            <p className="k">
              <i /> 03 / MEDIA NETWORK
            </p>
            <h2>From the venue to the audience.</h2>
            <p className="deck">TV, radio and digital organisations featured in Spotlight&apos;s media and collaborator directory. Season 2 carriage and airtimes are pending.</p>
            <ul className="logo-grid">
              <li>
                <img src="/assets/img/about/slider-dstv.jpeg" alt="" loading="lazy" />
                <span>DStv / GOtv</span>
              </li>
              <li>
                <img src="/assets/img/about/slider-tvc.jpeg" alt="" loading="lazy" />
                <span>TVC Entertainment</span>
              </li>
              <li>
                <img src="/assets/img/about/slider-wazobia.jpg" alt="" loading="lazy" />
                <span>Wazobia TV</span>
              </li>
              <li>
                <img src="/assets/img/about/slider-ravetv.png" alt="" loading="lazy" />
                <span>Rave TV</span>
              </li>
              <li>
                <img src="/assets/img/about/slider-waptv.jpeg" alt="" loading="lazy" />
                <span>WAP TV</span>
              </li>
              <li>
                <img src="/assets/img/about/slider-mitv.jpg" alt="" loading="lazy" />
                <span>MITV</span>
              </li>
              <li>
                <img src="/assets/img/about/slider-frcn.jpeg" alt="" loading="lazy" />
                <span>Radio Nigeria / FRCN</span>
              </li>
              <li>
                <img src="/assets/img/about/slider-clicknaija.jpg" alt="" loading="lazy" />
                <span>Click Naija</span>
              </li>
            </ul>
            <a className="source-link" href="https://www.spotlightng.com/media-room">
              Visit the Spotlight Media Room ↗
            </a>
          </section>

          <section className="circle">
            <div className="wrap">
              <p className="k">
                <i /> 04 / CELEBRITY & INFLUENCER CIRCLE
              </p>
              <h2>The people behind the spotlight.</h2>
              <p className="deck">Meet featured faces from Spotlight&apos;s community and Season 1 archive. Follow Season 2 for new guest and creator announcements.</p>
              <div className="portrait-grid">
                <figure>
                  <img src="/assets/img/about/supporters-larry.jpg" alt="Larry Gaaga" loading="lazy" />
                  <figcaption>
                    <strong>Larry Gaaga</strong>
                    <small>Spotlight patron</small>
                  </figcaption>
                </figure>
                <figure>
                  <img src="/assets/img/about/shape-yvonne-1.jpg" alt="Yvonne Jegede" loading="lazy" />
                  <figcaption>
                    <strong>Yvonne Jegede</strong>
                    <small>Season 1 mansion guest</small>
                  </figcaption>
                </figure>
                <figure>
                  <img src="/assets/img/about/supporters-faze.jpeg" alt="Faze" loading="lazy" />
                  <figcaption>
                    <strong>Faze</strong>
                    <small>Season 1 finale performer</small>
                  </figcaption>
                </figure>
                <figure>
                  <img src="/assets/img/about/supporters-ay.jpg" alt="AY Makun" loading="lazy" />
                  <figcaption>
                    <strong>AY Makun</strong>
                    <small>Featured supporter</small>
                  </figcaption>
                </figure>
              </div>
              <div className="creator">
                <div>
                  <strong>For creators and community voices</strong>
                  <p>Connect with Spotlight about audition coverage, contestant stories and watch-along content.</p>
                </div>
                <a className="button outline" href="https://www.spotlightng.com/contact">
                  Contact Spotlight ↗
                </a>
              </div>
            </div>
          </section>

          <Ballot />

          <section className="closer">
            <div className="wrap closer-grid">
              <div>
                <p className="k">
                  <i /> 06 / TAKE YOUR PLACE
                </p>
                <h2>
                  How will you
                  <br />
                  be part of it?
                </h2>
              </div>
              <div className="next-links">
                <a href="https://www.spotlightng.com/season-2">
                  <span>
                    <strong>Take the stage</strong>
                    <small>Explore Season 2 and registration</small>
                  </span>
                  <span>↗</span>
                </a>
                <a href="https://www.spotlightng.com/voting">
                  <span>
                    <strong>Back a contestant</strong>
                    <small>Visit official Spotlight voting</small>
                  </span>
                  <span>↗</span>
                </a>
                <a href="https://www.spotlightng.com/sponsor">
                  <span>
                    <strong>Partner with Spotlight</strong>
                    <small>Explore sponsorship opportunities</small>
                  </span>
                  <span>↗</span>
                </a>
              </div>
            </div>
          </section>
        </main>
      </div>
    </Layout>
  );
}
