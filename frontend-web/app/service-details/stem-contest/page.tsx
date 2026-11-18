'use client';

import './stem-contest.css';
import Layout from '@/components/layout/Layout';
import Link from 'next/link';
import Image from 'next/image';
import { FormEvent, useEffect, useRef, useState } from 'react';

const ASSETS = '/service-details/stem-contest';
const MAILTO = 'mailto:info@spotlightng.com';

type Credit = {
  caption: string;
  author: string;
  sourceUrl: string;
  licence: string;
  licenceUrl: string;
};

const ghanaCredit: Credit = {
  caption: 'Students from Northern College of Science and Technology, Ghana',
  author: 'Priscilla Sugri / Wikimedia Commons',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Students_of_Northern_College_of_Science_and_Technology.jpg',
  licence: 'CC0',
  licenceUrl: 'http://creativecommons.org/publicdomain/zero/1.0/deed.en',
};

const hackCredit: Credit = {
  caption: 'Developer training · Lagos State University, Nigeria',
  author: 'Oluphisayo / Wikimedia Commons',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:AWMD_prep_to_hackathon_meetup_6.jpg',
  licence: 'CC BY-SA 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
};

const slides = [
  {
    number: '01',
    name: 'School STEM',
    label: '1 of 3 — School STEM',
    file: 'hero-school.webp',
    alt: 'Uniformed students testing and presenting STEM projects.',
  },
  {
    number: '02',
    name: 'Youth Tech Hackathon',
    label: '2 of 3 — Youth Tech Hackathon',
    file: 'hero-hackathon.webp',
    alt: 'Young adults building and pitching technology prototypes.',
  },
  {
    number: '03',
    name: 'Two tracks, one stage',
    label: '3 of 3 — Two tracks, one stage',
    file: 'hero-combined.webp',
    alt: 'School teams and youth innovators demonstrating projects and celebrating together.',
  },
];

const stats = [
  { number: '01', label: 'School STEM contests' },
  { number: '02', label: 'Youth tech hackathons' },
  { number: '03', label: 'National championship' },
];

const schoolSteps = [
  {
    title: 'Enroll the school',
    text: 'An authorised teacher or coordinator submits the school’s details and selects its state.',
  },
  {
    title: 'Nominate and prepare',
    text: 'The school selects its team. Students identify a problem, build a prototype and record their tests.',
  },
  {
    title: 'Enter the inter-school round',
    text: 'Teams present a working model and explain their findings. Advancement follows the published rules for the state.',
  },
  {
    title: 'Compete at the state championship',
    text: 'Qualifying schools demonstrate their projects and answer judges’ questions at the state final.',
  },
];

const youthSteps = [
  {
    title: 'Apply and qualify',
    text: 'Build a team across design, engineering and pitching. Enter your state’s hackathon and follow the selection brief.',
  },
  {
    title: 'Join the televised build',
    text: 'In the proposed reality TV format, selected teams receive a challenge and document their approach during timed builds.',
  },
  {
    title: 'Face the demo review',
    text: 'Teams test their prototypes, respond to mentor feedback and present their work under the published judging rules.',
  },
  {
    title: 'Pitch at the national finale',
    text: 'Selected teams demonstrate their solutions, explain who benefits and show what it would take to launch.',
  },
];

const fieldNotes = [
  {
    label: '01 / ROBOTICS WORKSHOP',
    title: 'Start with a real problem',
    text: 'A school team could measure water use, improve accessibility or solve a problem in its community. Keep a build log showing the first idea, what failed and what changed.',
    file: 'photo-robot.webp',
    width: 1067,
    height: 1600,
    alt: 'Young participants build a solar-powered robot at Scifest Africa',
    credit: {
      caption: 'Robotics training · Scifest Africa, South Africa',
      author: 'Skadge / Wikimedia Commons',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Robotics_workshop_scifest_africa_2008.jpg',
      licence: 'CC BY-SA 3.0',
      licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
    },
  },
  {
    label: '02 / HACKATHON',
    title: 'Build under a deadline',
    text: 'Divide the work between research, prototyping, testing and presenting. Prepare a version that judges can try, and show how it behaves when something goes wrong.',
    file: 'photo-hack.webp',
    width: 1600,
    height: 1200,
    alt: 'Participants work together during an AWMD developers meetup at Lagos State University',
    credit: hackCredit,
  },
  {
    label: '03 / COMPETITION RECOGNITION',
    title: 'Show the evidence',
    text: 'Use the pitch to connect the prototype to its intended users. Explain how you tested it, what it costs, and what you would improve before deployment.',
    file: 'photo-lagos.webp',
    width: 1024,
    height: 681,
    alt: 'Recognition ceremony at the Lagos Hackathon 2020',
    credit: {
      caption: 'Hackathon recognition · Lagos Hackathon 2020, Nigeria',
      author: 'Kaizenify / Wikimedia Commons',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Femi_Hamzat_at_the_Lagos_Hackathon_2020_07.jpg',
      licence: 'CC BY-SA 4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
    },
  },
  {
    label: '04 / FIELD LEARNING',
    title: 'Take the lesson outside',
    text: 'Observe a real environment before designing a solution. Record what you see, then use it to decide what your team should test.',
    file: 'photo-ghana.webp',
    width: 1099,
    height: 827,
    alt: 'Students in school uniforms alongside a water channel',
    credit: ghanaCredit,
  },
];

const prepList = [
  {
    title: 'Choose a challenge',
    text: 'Name the people affected and observe how they currently handle the problem.',
  },
  {
    title: 'Define a test',
    text: 'Pick one result you can measure, such as time saved, accuracy or material cost.',
  },
  {
    title: 'Document the build',
    text: 'Bring a short demo, team roles, photos of iterations and the key test results.',
  },
  {
    title: 'Prepare a backup',
    text: 'Keep a recorded walkthrough or screenshots ready if the live demo fails.',
  },
];

const faqs = [
  {
    question: 'What types of projects could a team bring?',
    answer:
      'Possible projects include robotics, software, clean energy, agriculture, health or accessibility. Match your idea to the current round’s published theme and entry rules.',
  },
  {
    question: 'How should a school prepare its students?',
    answer:
      'Nominate a coordinator, confirm team roles and support safe prototyping. Check the official instructions for team size, age requirements and school consent.',
  },
  {
    question: 'What should we show judges?',
    answer:
      'As a preparation guide, show the problem, your prototype, test results and what each team member contributed. Official judging criteria are set for each round.',
  },
  {
    question: 'How are placements and exchange places awarded?',
    answer:
      'The programme proposes opportunities for selected participants. Eligibility, available places, employer decisions and the China exchange terms depend on official announcements.',
  },
];

const beyondFeatures = [
  {
    eyebrow: '01 / CAREER',
    title: 'Tech placements',
    text: 'Selected innovators may be introduced to leading tech companies for internships, interviews or job placement opportunities.',
  },
  {
    eyebrow: '02 / RECOGNITION',
    title: 'Prizes and global exposure',
    text: 'Competition awards and international travel opportunities are subject to the official award list and selection criteria.',
  },
  {
    eyebrow: '03 / INDUSTRY',
    title: 'Brand ambassador deals',
    text: 'Telco and technology companies can consider standout innovators for ambassador roles and campaigns, subject to partner selection and written terms.',
  },
];

const mediaFeatures = [
  {
    eyebrow: '01 / PAY TV',
    title: 'DStv / GOtv',
    text: 'Featured in Spotlight’s media network. Season carriage is subject to confirmation.',
  },
  {
    eyebrow: '02 / TERRESTRIAL',
    title: 'Private, federal and state media',
    text: 'Proposed school features, regional interviews and championship highlights for local and national audiences.',
  },
  {
    eyebrow: '03 / VIDEO ON DEMAND',
    title: 'Catch-up and demo cuts',
    text: 'Proposed episodes, short prototype explainers and team profiles for digital distribution, subject to rights.',
  },
];

const platforms = [
  'Cloud & developer tools',
  'Hardware & maker labs',
  'Connectivity',
  'Learning platforms',
];

const broadcasters = [
  { name: 'DStv / GOtv', kind: 'TV', file: 'slider-dstv.jpeg', width: 300, height: 168 },
  { name: 'TVC Entertainment', kind: 'TV', file: 'slider-tvc.jpeg', width: 225, height: 224 },
  { name: 'Wazobia TV', kind: 'TV', file: 'slider-wazobia.jpg', width: 300, height: 160 },
  { name: 'Rave TV', kind: 'TV', file: 'slider-ravetv.png', width: 160, height: 160 },
  { name: 'WAP TV', kind: 'TV', file: 'slider-waptv.jpeg', width: 200, height: 150 },
  { name: 'MITV', kind: 'TV', file: 'slider-mitv.jpg', width: 160, height: 160 },
  { name: 'Radio Nigeria / FRCN', kind: 'Radio', file: 'slider-frcn.jpeg', width: 299, height: 169 },
];

const creators = [
  { name: 'Ayo Makun (AY)', file: 'supporters-ay.jpg', width: 1080, height: 1440 },
  { name: 'William Benson', file: 'supporters-william.jpg', width: 1080, height: 1080 },
  { name: 'Bucci Franklin', file: 'supporters-bucci.jpg', width: 1080, height: 1350 },
];

const enrollmentFields = [
  { label: 'School name', maxLength: 120 },
  { label: 'State or FCT', maxLength: 60 },
  { label: 'Local government area', maxLength: 80 },
  { label: 'Coordinator name', maxLength: 100, autoComplete: 'name' },
  { label: 'School email', maxLength: 120, type: 'email' },
  { label: 'Coordinator phone', maxLength: 30, type: 'tel' },
];

function ArrowIcon({ down = false }: { down?: boolean }) {
  return (
    <svg className="link-icon" aria-hidden="true" viewBox="0 0 16 16">
      {down ? <path d="M8 3v10m-4-4 4 4 4-4" /> : <path d="M4 12 12 4M5 4h7v7" />}
    </svg>
  );
}

function PhotoCredit({ credit }: { credit: Credit }) {
  return (
    <p className="photo-credit">
      {credit.caption}
      <br />
      <a href={credit.sourceUrl}>{credit.author}</a> ·{' '}
      <a href={credit.licenceUrl}>{credit.licence}</a> · WebP resize
    </p>
  );
}

/*
 * The export drives this loader from an inline head script: hidden in the
 * markup, shown only while the document is still loading, with a 5.8s
 * safeguard and a CSS failsafe at 6s. If hydration lands after the load
 * event, the loader never appears — same as the original.
 */
function Loader() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loader = ref.current;
    if (!loader) return;

    let dismissal: ReturnType<typeof setTimeout> | undefined;
    let safeguard: ReturnType<typeof setTimeout> | undefined;

    const hide = () => {
      clearTimeout(safeguard);
      loader.setAttribute('data-exit', '');
      clearTimeout(dismissal);
      dismissal = setTimeout(() => {
        loader.hidden = true;
      }, 300);
    };

    const show = () => {
      clearTimeout(dismissal);
      clearTimeout(safeguard);
      loader.hidden = true;
      loader.removeAttribute('data-exit');
      // Flush the hidden state so the safeguard timer restarts on replay.
      void loader.offsetWidth;
      loader.hidden = false;
      safeguard = setTimeout(hide, 5800);
    };

    if (document.readyState !== 'complete') {
      show();
      window.addEventListener('load', hide, { once: true });
    }

    return () => {
      clearTimeout(dismissal);
      clearTimeout(safeguard);
    };
  }, []);

  return (
    <div id="spotlight-loader" ref={ref} role="status" aria-live="polite" aria-atomic="true" hidden>
      <div className="sp-lockup">
        <svg viewBox="0 0 180 180" aria-hidden="true">
          <defs>
            <linearGradient id="sp-metal" x2="100%" y2="100%">
              <stop stopColor="#ffe0b2" />
              <stop offset=".46" stopColor="#efa97a" />
              <stop offset="1" stopColor="#ad67d3" />
            </linearGradient>
            <linearGradient id="sp-light">
              <stop stopColor="#efa97a" stopOpacity="0" />
              <stop offset=".5" stopColor="#fff1d5" />
              <stop offset="1" stopColor="#efa97a" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="sp-halo">
              <stop stopColor="#efa97a" stopOpacity=".3" />
              <stop offset="1" stopColor="#efa97a" stopOpacity="0" />
            </radialGradient>
            <path id="sp-mark" d="M7 3 43 13v14L18 39v-9l14-7-25-7V3Zm0 20 13 4v13l23-10v13L7 53V23Z" />
            <clipPath id="sp-mark-mask">
              <use href="#sp-mark" transform="translate(54 49) scale(1.44)" />
            </clipPath>
          </defs>
          <circle cx="90" cy="90" r="74" fill="none" stroke="#b39bbd" strokeOpacity=".19" />
          <circle cx="90" cy="90" r="64" fill="none" stroke="#b39bbd" strokeOpacity=".12" />
          <path
            d="M90 10v8m80 72h-8m-72 80v-8m-80-72h8"
            fill="none"
            stroke="#bba4c5"
            strokeOpacity=".48"
          />
          <use href="#sp-mark" transform="translate(54 49) scale(1.44)" fill="url(#sp-metal)" opacity=".84" />
          <g clipPath="url(#sp-mark-mask)">
            <g className="sp-sweep">
              <rect
                x="64"
                y="35"
                width="52"
                height="110"
                fill="url(#sp-light)"
                transform="rotate(20 90 90)"
                opacity=".85"
              />
            </g>
          </g>
          <g className="sp-rotor" fill="none">
            <path
              d="M24 57a74 74 0 0 1 66-41"
              stroke="url(#sp-metal)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle cx="90" cy="16" r="14" fill="url(#sp-halo)" />
            <circle cx="90" cy="16" r="2.3" fill="#ffe3bc" />
          </g>
        </svg>
        <p className="sp-wordmark" aria-hidden="true">
          SPOTLIGHT
        </p>
        <p className="sp-status">Loading Spotlight</p>
      </div>
    </div>
  );
}

function HeroCarousel() {
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(true);
  const [announcement, setAnnouncement] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Mirrors the export's schedule(): re-armed after every state change, and
  // silent while paused, hovered, hidden, or under reduced motion.
  useEffect(() => {
    clearTimeout(timer.current);
    if (playing && !hovered && visible) {
      timer.current = setTimeout(() => setCurrent((index) => (index + 1) % slides.length), 6500);
    }
    return () => clearTimeout(timer.current);
  });

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onVisibilityChange = () => setVisible(!document.hidden);
    const onMotionChange = () => {
      if (reducedMotion.matches) setPlaying(false);
    };

    if (reducedMotion.matches) setPlaying(false);
    onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibilityChange);
    reducedMotion.addEventListener('change', onMotionChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      reducedMotion.removeEventListener('change', onMotionChange);
    };
  }, []);

  function select(index: number) {
    setPlaying(false);
    const next = (index + slides.length) % slides.length;
    setCurrent(next);
    setAnnouncement(slides[next].label);
  }

  return (
    <section
      className="hero-carousel"
      aria-label="STEM and Tech campaign banners"
      aria-roledescription="carousel"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        if (!(event.target as HTMLElement).hasAttribute('data-rotation')) setPlaying(false);
      }}
    >
      <div className="carousel-window">
        <div className="carousel-track" style={{ transform: `translateX(-${current * 100}%)` }}>
          {slides.map((slide, index) => (
            <figure
              className="hero-slide"
              key={slide.file}
              aria-label={slide.label}
              aria-hidden={index !== current}
            >
              <Image
                src={`${ASSETS}/${slide.file}`}
                width={1774}
                height={887}
                alt={slide.alt}
                sizes="(max-width: 680px) 92vw, 1144px"
                {...(index === 0 ? { priority: true } : { loading: 'lazy', decoding: 'async' })}
              />
            </figure>
          ))}
        </div>
      </div>
      <div className="carousel-bar">
        <div className="carousel-choices" role="group" aria-label="Choose a banner">
          {slides.map((slide, index) => (
            <button
              type="button"
              key={slide.number}
              data-slide={index}
              aria-pressed={index === current}
              onClick={() => select(index)}
            >
              <span>{slide.number}</span> {slide.name}
            </button>
          ))}
        </div>
        <div className="carousel-controls">
          <button type="button" data-direction="-1" aria-label="Previous banner" onClick={() => select(current - 1)}>
            ‹
          </button>
          <button type="button" data-rotation onClick={() => setPlaying((active) => !active)}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" data-direction="1" aria-label="Next banner" onClick={() => select(current + 1)}>
            ›
          </button>
        </div>
      </div>
      <p className="campaign-credit">
        Illustrative campaign imagery{' '}
        <span id="carousel-status" className="sr-only" role="status">
          {announcement}
        </span>
      </p>
    </section>
  );
}

function EnrollmentForm() {
  const form = useRef<HTMLFormElement>(null);
  const draft = useRef<HTMLAnchorElement>(null);
  const [status, setStatus] = useState('');

  function clearDraft() {
    if (draft.current) draft.current.hidden = true;
    setStatus('');
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = [...new FormData(event.currentTarget)]
      .map(([label, value]) => `${label}: ${String(value).trim()}`)
      .join('\n');
    const anchor = draft.current;
    if (anchor) {
      anchor.href = `${MAILTO}?subject=${encodeURIComponent('School STEM championship enrollment enquiry')}&body=${encodeURIComponent(body)}`;
      anchor.hidden = false;
      anchor.focus();
    }
    setStatus('Your draft is ready. Open it in your email app, review it, and send it to Spotlight.');
  }

  return (
    <form id="school-enrollment-form" className="enrollment-form" ref={form} onInput={clearDraft} onSubmit={onSubmit}>
      <div className="fields">
        {enrollmentFields.map((field) => (
          <label key={field.label}>
            {field.label}
            <input
              name={field.label}
              type={field.type}
              autoComplete={field.autoComplete}
              required
              maxLength={field.maxLength}
            />
          </label>
        ))}
      </div>
      <label>
        Project idea or enquiry{' '}
        <textarea name="Project idea or enquiry" rows={3} maxLength={450} />
      </label>
      <button className="button primary" type="submit">
        Prepare enrollment email
      </button>
      <p id="enrollment-status" role="status">
        {status}
      </p>
      <a id="enrollment-draft" ref={draft} className="button primary" hidden>
        Open email draft
      </a>
    </form>
  );
}

function Track({
  tone,
  number,
  label,
  id,
  titleId,
  title,
  intro,
  applyText,
  applyHref,
  secondary,
  photo,
  photoWidth,
  photoHeight,
  photoAlt,
  credit,
  steps,
}: {
  tone: 'school' | 'youth';
  number: string;
  label: string;
  id: string;
  titleId: string;
  title: string;
  intro: string;
  applyText: string;
  applyHref: string;
  secondary?: { text: string; href: string };
  photo: string;
  photoWidth: number;
  photoHeight: number;
  photoAlt: string;
  credit: Credit;
  steps: Array<{ title: string; text: string }>;
}) {
  const apply = (
    <>
      <a className="button primary" href={applyHref}>
        {applyText}
      </a>
      {secondary && (
        <a className="track-link" href={secondary.href}>
          {secondary.text}
        </a>
      )}
    </>
  );

  return (
    <section className={`track track-${tone}`} id={id} aria-labelledby={titleId}>
      <div className="wrap track-inner">
        <div className="track-lead">
          <p className="k">
            {number} / {label}
          </p>
          <h3 id={titleId}>{title}</h3>
          <p>{intro}</p>
          <div className="actions">{apply}</div>
        </div>
        <figure className="track-photo">
          <Image
            src={`${ASSETS}/${photo}`}
            width={photoWidth}
            height={photoHeight}
            alt={photoAlt}
            sizes="(max-width: 680px) 92vw, 560px"
            loading="lazy"
            decoding="async"
          />
          <figcaption>
            {credit.caption}
            <br />
            <a href={credit.sourceUrl}>{credit.author}</a> ·{' '}
            <a href={credit.licenceUrl}>{credit.licence}</a> · WebP resize
          </figcaption>
        </figure>
        <ol className="track-steps four">
          {steps.map((step, index) => (
            <li key={step.title}>
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <h4>{step.title}</h4>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const railLinks = [
  { href: '#route', label: 'Competition route' },
  { href: '#school-enrollment', label: 'School enrollment' },
  { href: '#network', label: 'Partners' },
  { href: '#opportunities', label: 'Opportunities' },
];

export default function StemContestPage() {
  const rail = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  // main.css flips #header-sticky to position:fixed past 100px, which takes it
  // out of flow and yanks the page up by its own height mid-scroll — the spacer
  // hands that height back in the same frame so nothing jumps.
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 100);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // The rail sticks under the header and anchor jumps clear both, so both
  // heights are measured — the header changes height when it goes sticky.
  useEffect(() => {
    const header = document.getElementById('header-sticky');
    const bar = rail.current;
    if (!header || !bar) return;
    const sync = () => {
      const root = document.documentElement.style;
      root.setProperty('--stem-rail-top', `${header.offsetHeight}px`);
      root.setProperty('--stem-chrome-top', `${header.offsetHeight + bar.offsetHeight}px`);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(header);
    observer.observe(bar);
    return () => observer.disconnect();
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
      <div className="stemContest">
        <Loader />
        <a className="skip" href="#main">
          Skip to content
        </a>

        {stuck && <div className="header-spacer" aria-hidden="true" />}

        <div className="section-rail" ref={rail}>
          <div className="wrap">
            <nav aria-label="Page sections">
              {railLinks.map((link) => (
                <a key={link.href} href={link.href}>
                  {link.label}
                </a>
              ))}
              <Link href="/service-details/open-mic-competition">
                Open Mic <ArrowIcon />
              </Link>
            </nav>
            <a className="button outline" href="/apply">
              Explore entry <ArrowIcon />
            </a>
          </div>
        </div>

        <main id="main">
        <section className="hero">
          <div className="wrap hero-inner">
            <div className="hero-copy">
              <div className="edition">
                <span>SPOTLIGHT COMPETITIONS</span>
                <span>01 / INNOVATION</span>
              </div>
              <p className="k">01 / THE INNOVATION PILLAR</p>
              <h1>
                Build it here.
                <br />
                <em>Take it further.</em>
              </h1>
              <p className="lead">
                Two competitions for Nigerian innovators. School teams build and test prototypes, while older youth
                tackle statewide tech challenges and pitch for a place at nationals.
              </p>
              <div className="actions">
                <a className="button primary" href="/apply">
                  Explore entry <ArrowIcon />
                </a>
                <a className="button outline" href="#route">
                  See how it works <ArrowIcon down />
                </a>
              </div>
            </div>
            <HeroCarousel />
          </div>
        </section>

        <div className="stats">
          <div className="wrap">
            {stats.map((item) => (
              <div key={item.number}>
                <strong>{item.number}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <section className="competition-tracks" id="route" aria-labelledby="tracks-title">
          <div className="wrap tracks-intro">
            <p className="k">02 / THE COMPETITION ROUTE</p>
            <h2 id="tracks-title">Find your competition.</h2>
            <p>
              School teams represent their schools at state level. Older youth enter a separate technology hackathon
              with a reality TV showcase.
            </p>
            <nav className="track-jumps" aria-label="Choose a competition">
              <a href="#school-stem">
                <span>01</span> School STEM
              </a>
              <a href="#youth-hackathon">
                <span>02</span> Youth Tech Hackathon
              </a>
            </nav>
          </div>

          <Track
            tone="school"
            number="01"
            label="SCHOOL TEAMS"
            id="school-stem"
            titleId="school-title"
            title="Inter-school STEM State Championship"
            intro="For students working in school teams with a teacher or coordinator. Use science, technology, engineering or maths to investigate a problem and demonstrate a solution."
            applyText="Start school enrollment"
            applyHref="#school-enrollment"
            secondary={{ text: 'See the school prep list', href: '#prepare' }}
            photo="photo-ghana.webp"
            photoWidth={1099}
            photoHeight={827}
            photoAlt="Students in school uniform alongside a water channel during field learning in Ghana"
            credit={ghanaCredit}
            steps={schoolSteps}
          />

          <Track
            tone="youth"
            number="02"
            label="OLDER YOUTH"
            id="youth-hackathon"
            titleId="youth-title"
            title="Youth Tech Hackathon"
            intro="For older youth ready to solve a practical challenge with software, hardware or data. Start at a statewide hackathon and compete to pitch your solution at the national championship."
            applyText="Explore hackathon entry"
            applyHref="/apply"
            photo="photo-hack.webp"
            photoWidth={1600}
            photoHeight={1200}
            photoAlt="Adult participants at a developer meetup at Lagos State University"
            credit={hackCredit}
            steps={youthSteps}
          />

          <p className="wrap tracks-note">
            Check Spotlight’s official entry instructions for age requirements, team sizes, dates and qualification
            rules for your competition.
          </p>
        </section>

        <section className="paper" id="school-enrollment">
          <div className="wrap pad enrollment-grid">
            <div>
              <p className="k">SCHOOL ENROLLMENT</p>
              <h2>Nominate your school.</h2>
              <p>
                An authorised school representative can prepare an enrollment enquiry. Spotlight can then confirm
                eligibility, dates and the next steps for your state.
              </p>
              <p className="fine">
                Use adult coordinator details only. Student records and supporting documents can follow through the
                official enrollment process if requested.
              </p>
            </div>
            <EnrollmentForm />
          </div>
        </section>

        <section className="fieldnotes" id="field-notes">
          <div className="wrap pad">
            <p className="k">STEM / FIELD NOTES</p>
            <h2>See what it takes to build.</h2>
            <p>Follow the work behind the pitch, from the first classroom test to the prototype teams put in front of judges.</p>
            <div className="story-grid">
              {fieldNotes.map((note) => (
                <figure key={note.label}>
                  <div className={note.file === 'photo-robot.webp' ? 'still still-robot' : 'still'}>
                    <Image
                      src={`${ASSETS}/${note.file}`}
                      width={note.width}
                      height={note.height}
                      alt={note.alt}
                      sizes="(max-width: 620px) 92vw, 45vw"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <figcaption>
                    <span>{note.label}</span>
                    <h3>{note.title}</h3>
                    <p>{note.text}</p>
                    <PhotoCredit credit={note.credit} />
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="image-note">Documentary reference photos. Captions identify the original setting.</p>
          </div>
        </section>

        <section className="wrap pad prep-grid" id="prepare">
          <div>
            <p className="k">ENTRY PREPARATION</p>
            <h2>The school team’s prep list</h2>
            <ol>
              {prepList.map((item) => (
                <li key={item.title}>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="prep-aside">
            <p className="k">PROGRAMME DESK</p>
            <h3>School and team questions</h3>
            <div className="faq">
              {faqs.map((faq) => (
                <details key={faq.question}>
                  <summary>{faq.question}</summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="paper">
          <div className="wrap pad">
            <p className="k">03 / BEYOND THE CHAMPIONSHIP</p>
            <h2>Turn a prototype into a path.</h2>
            <div className="features">
              {beyondFeatures.map((feature) => (
                <article key={feature.eyebrow}>
                  <b>{feature.eyebrow}</b>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="wrap pad exchange" id="opportunities">
          <div className="seal">
            <span>
              NIGERIA <i /> CHINA
            </span>
            <strong>02</strong>
            <span>MONTHS / PROPOSED EXCHANGE</span>
          </div>
          <div>
            <p className="k">04 / CULTURAL EXCHANGE</p>
            <h2>Two months in China.</h2>
            <p>
              A proposed all-expenses-paid Nigeria–China cultural exchange for selected participants. The programme is
              designed around cultural immersion, peer learning and exposure to new approaches to technology and
              problem-solving.
            </p>
            <p className="fine">Places, eligibility, travel dates and covered costs depend on confirmed programme terms.</p>
          </div>
        </section>

        <section className="media">
          <div className="wrap pad">
            <p className="k">05 / THE REALITY TV FORMAT</p>
            <h2>Put the build on screen.</h2>
            <p>
              Follow teams from problem selection and prototype failures to timed builds, mentor feedback and the final
              pitch. The proposed coverage turns each milestone into a story viewers can follow.
            </p>
            <div className="features">
              {mediaFeatures.map((feature) => (
                <article key={feature.eyebrow}>
                  <b>{feature.eyebrow}</b>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </article>
              ))}
            </div>
            <a className="textlink" href="/sponsors-partners">
              Explore Spotlight’s partner network <ArrowIcon />
            </a>
          </div>
        </section>

        <section className="wrap pad" id="network">
          <p className="k">06 / THE COLLABORATOR NETWORK</p>
          <h2>Who helps bring the work to light?</h2>
          <h3>Tech platform collaborators</h3>
          <p>
            Cloud and developer tools, hardware and maker labs, connectivity, and learning platforms can support
            participants. Logos will be added here when collaborators are approved for publication.
          </p>
          <div className="platform-grid" aria-label="Proposed technology collaboration areas">
            {platforms.map((platform) => (
              <span key={platform}>{platform}</span>
            ))}
          </div>
          <h3>Spotlight media network · TV and radio</h3>
          <p>Organisations featured by Spotlight. STEM-specific coverage, broadcast dates and airtime are subject to confirmation.</p>
          <div className="logo-grid">
            {broadcasters.map((broadcaster) => (
              <figure key={broadcaster.name}>
                <Image
                  src={`${ASSETS}/${broadcaster.file}`}
                  width={broadcaster.width}
                  height={broadcaster.height}
                  alt=""
                  sizes="(max-width: 680px) 46vw, 155px"
                  loading="lazy"
                  decoding="async"
                />
                <figcaption>
                  <b>{broadcaster.name}</b>
                  <span>{broadcaster.kind}</span>
                </figcaption>
              </figure>
            ))}
          </div>
          <h3>Spotlight’s wider creator community</h3>
          <p>
            Featured supporters from across Spotlight. The STEM influencer and mentor lineup will be published
            separately once confirmed.
          </p>
          <div className="creator-grid">
            {creators.map((creator) => (
              <figure key={creator.name}>
                <Image
                  src={`${ASSETS}/${creator.file}`}
                  width={creator.width}
                  height={creator.height}
                  alt=""
                  sizes="(max-width: 680px) 30vw, 180px"
                  loading="lazy"
                  decoding="async"
                />
                <figcaption>{creator.name}</figcaption>
              </figure>
            ))}
          </div>
          <a className="textlink" href="/sponsors-partners">
            Explore Spotlight’s partner network
          </a>
        </section>

        <section className="closing">
          <div className="wrap pad closing-inner">
            <p className="k">YOUR NEXT MOVE</p>
            <h2>Bring your idea to Spotlight.</h2>
            <div className="actions">
              <a className="button primary" href="/apply">
                Explore entry <ArrowIcon />
              </a>
              <a className="button outline" href="/contact">
                School and partner enquiries <ArrowIcon />
              </a>
            </div>
          </div>
        </section>
        </main>
      </div>
    </Layout>
  );
}
