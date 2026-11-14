'use client';

import Image from 'next/image';
import Link from 'next/link';
import { FormEvent, KeyboardEvent, useRef, useState } from 'react';
import {
  NIGERIA_CITIES_BY_STATE,
  NIGERIA_STATES,
} from '@/src/features/registration/reference-data';
import OpenMicEditionSteps from './OpenMicEditionSteps';
import type { OpenMicEditionStepsData } from '@/src/features/openmic/active-edition';

const testimonials = [
  {
    number: '01',
    edition: 'LAGOS / MARCH EDITION',
    name: 'Adaeze N.',
    role: 'Singer-songwriter',
    quote:
      'I had never performed outside a church hall before. The first round taught me how to hold a room. The second taught me how to hold a note when the room goes quiet.',
    image: 'photo-vocal.webp',
    alt: 'A recording artist working through a vocal take in a studio.',
    credit: (
      <>
        Studio portrait · Spotlight photo archive
        <br />{' '}
        <a href="https://commons.wikimedia.org/wiki/File:ForGod_(Ogbonna_Arinze_Timothy)_in_Recording_Studio.jpg">
          XanidyK / Wikimedia Commons
        </a>{' '}
        ·{' '}
        <a href="https://creativecommons.org/licenses/by-sa/4.0">
          CC BY-SA 4.0
        </a>{' '}
        · WebP resize
      </>
    ),
  },
  {
    number: '02',
    edition: 'ABUJA / APRIL EDITION',
    name: 'Tobenna O.',
    role: 'Rapper',
    quote:
      'The judges told me my second verse was doing all the talking and my first verse was doing none. I rewrote it in two days. That note is the reason I got through.',
    image: 'photo-mix.webp',
    alt: 'A recording engineer at the mixing desk during a session.',
    credit: (
      <>
        Studio 51 · mixdown session
        <br />{' '}
        <a href="https://commons.wikimedia.org/wiki/File:Mixdown_at_Studio_51.jpg">
          Aderogba Arimoro / Wikimedia Commons
        </a>{' '}
        ·{' '}
        <a href="https://creativecommons.org/licenses/by-sa/4.0">
          CC BY-SA 4.0
        </a>{' '}
        · WebP resize
      </>
    ),
  },
  {
    number: '03',
    edition: 'PORT HARCOURT / MAY EDITION',
    name: 'Halima B.',
    role: 'Spoken-word artist',
    quote:
      'Voting week was the hardest part, not the stage. My friends shared the link every morning. When the results came out, it felt like the whole street had won something.',
    image: 'photo-spotlight-performance.webp',
    alt: 'A vocalist performing live with a handheld microphone.',
    credit: (
      <>
        Live performance · Spotlight photo archive
        <br />{' '}
        <a href="/">Spotlight photo archive</a>
      </>
    ),
  },
  {
    number: '04',
    edition: 'LAGOS / JUNE EDITION',
    name: 'Kelechi A.',
    role: 'Producer and drummer',
    quote:
      'I came in to accompany a friend and left with a studio session of my own. The lounge nights are where artists actually meet each other, not just the panel.',
    image: 'photo-spotlight-stage.webp',
    alt: 'A performer on the Spotlight stage in front of an audience.',
    credit: (
      <>
        Spotlight stage · Spotlight photo archive
        <br />{' '}
        <a href="/">Spotlight photo archive</a>
      </>
    ),
  },
  {
    number: '05',
    edition: 'LAGOS / SEPTEMBER EDITION',
    name: 'Ifeoma E.',
    role: 'Vocalist',
    quote:
      'Nobody at Spotlight told me the competition would be easy. They told me the feedback would be honest. That is the difference between a platform and a popularity contest.',
    image: 'photo-spotlight-stage.webp',
    alt: 'Stage lights over a live Spotlight performance.',
    credit: (
      <>
        Spotlight stage · Spotlight photo archive
        <br />{' '}
        <a href="/">Spotlight photo archive</a>
      </>
    ),
  },
];

const prizes = [
  {
    label: '01 / CASH PRIZE',
    title: '₦1 million',
    description: 'The selected artist wins the monthly cash award.',
  },
  {
    label: '02 / STUDIO',
    title: 'Record the entry song',
    description:
      'Take your competition song into a professional studio for a recording session.',
  },
  {
    label: '03 / MUSIC VIDEO',
    title: 'Choose your song',
    description:
      'Get a free music video shoot for a song of your choice, including a different track from your entry.',
  },
];

function ArrowIcon({ down = false }: { down?: boolean }) {
  return (
    <svg
      className="openMic-arrow"
      aria-hidden="true"
      viewBox="0 0 16 16"
      focusable="false"
    >
      {down ? (
        <path d="M8 3v10m-4-4 4 4 4-4" />
      ) : (
        <path d="M4 12 12 4M5 4h7v7" />
      )}
    </svg>
  );
}

type LoungeForm = {
  loungeName: string;
  contactPerson: string;
  email: string;
  phone: string;
  state: string;
  city: string;
  capacity: string;
  proposal: string;
};

const EMPTY_LOUNGE_FORM: LoungeForm = {
  loungeName: '',
  contactPerson: '',
  email: '',
  phone: '',
  state: '',
  city: '',
  capacity: '',
  proposal: '',
};

function LoungeApplication() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<LoungeForm>(EMPTY_LOUNGE_FORM);
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  const cities = form.state ? NIGERIA_CITIES_BY_STATE[form.state] ?? [] : [];
  const busy = phase === 'sending';

  function update<K extends keyof LoungeForm>(key: K, value: string) {
    setForm((current) =>
      key === 'state' ? { ...current, state: value, city: '' } : { ...current, [key]: value },
    );
    if (error) setError('');
  }

  function reset() {
    setForm(EMPTY_LOUNGE_FORM);
    setPhase('idle');
    setError('');
  }

  async function submitApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setPhase('sending');
    setError('');

    try {
      const response = await fetch('/api/open-mic/lounge-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;

      if (response.ok && data?.ok) {
        setPhase('sent');
      } else {
        setPhase('idle');
        setError(data?.message || 'We could not send your application. Please try again.');
      }
    } catch {
      setPhase('idle');
      setError('We could not reach Spotlight right now. Check your connection and try again.');
    }
  }

  return (
    <>
      <button
        className="openMic-button openMic-buttonPrimary"
        type="button"
        onClick={() => {
          reset();
          dialogRef.current?.showModal();
        }}
      >
        Apply as a lounge <ArrowIcon />
      </button>
      <dialog
        className="openMic-dialog"
        ref={dialogRef}
        aria-labelledby="lounge-title"
        onClose={reset}
      >
        <button
          className="openMic-dialogClose"
          type="button"
          aria-label="Close lounge application"
          onClick={() => dialogRef.current?.close()}
        >
          ×
        </button>
        <p className="openMic-kicker">OPEN MIC / VENUE PARTNERS</p>
        {phase === 'sent' ? (
          <div className="openMic-dialogSuccess" role="status">
            <h2 id="lounge-title">Sent. Thank you.</h2>
            <p className="openMic-dialogIntro">
              We’ve received your lounge application and emailed you a copy. The
              Spotlight venues team reviews applications weekly and will reply to{' '}
              <strong>{form.email}</strong>.
            </p>
            <div className="openMic-dialogSuccessActions">
              <button type="button" className="openMic-button openMic-buttonPrimary" onClick={reset}>
                Send another
              </button>
              <button
                type="button"
                className="openMic-button openMic-buttonOutline"
                onClick={() => dialogRef.current?.close()}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            <h2 id="lounge-title">Apply as a lounge.</h2>
            <p className="openMic-dialogIntro">
              Tell Spotlight what you can host. We’ll send your venue details to
              the Open Mic team and email you a copy.
            </p>
            <form className="openMic-loungeForm" onSubmit={submitApplication} aria-busy={busy}>
              <div className="openMic-fields">
                <label>
                  Lounge name
                  <input
                    name="loungeName"
                    value={form.loungeName}
                    onChange={(event) => update('loungeName', event.target.value)}
                    required
                    maxLength={100}
                    autoComplete="organization"
                    disabled={busy}
                  />
                </label>
                <label>
                  Contact person
                  <input
                    name="contactPerson"
                    value={form.contactPerson}
                    onChange={(event) => update('contactPerson', event.target.value)}
                    required
                    maxLength={100}
                    autoComplete="name"
                    disabled={busy}
                  />
                </label>
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={(event) => update('email', event.target.value)}
                    required
                    maxLength={120}
                    autoComplete="email"
                    disabled={busy}
                  />
                </label>
                <label>
                  Phone
                  <input
                    name="phone"
                    type="tel"
                    value={form.phone}
                    onChange={(event) => update('phone', event.target.value)}
                    required
                    maxLength={30}
                    autoComplete="tel"
                    disabled={busy}
                  />
                </label>
                <label>
                  State
                  <select
                    name="state"
                    value={form.state}
                    onChange={(event) => update('state', event.target.value)}
                    required
                    disabled={busy}
                  >
                    <option value="" disabled>
                      Select a state
                    </option>
                    {NIGERIA_STATES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  City
                  <select
                    name="city"
                    value={form.city}
                    onChange={(event) => update('city', event.target.value)}
                    required
                    disabled={busy || !form.state}
                  >
                    <option value="" disabled>
                      {form.state ? 'Select a city' : 'Choose a state first'}
                    </option>
                    {cities.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Seated capacity
                  <input
                    name="capacity"
                    type="number"
                    value={form.capacity}
                    onChange={(event) => update('capacity', event.target.value)}
                    min={1}
                    max={100000}
                    required
                    disabled={busy}
                  />
                </label>
              </div>
              <label>
                Sound setup and event proposal
                <textarea
                  name="proposal"
                  value={form.proposal}
                  onChange={(event) => update('proposal', event.target.value)}
                  required
                  maxLength={750}
                  rows={3}
                  disabled={busy}
                />
              </label>
              {error && (
                <p className="openMic-status openMic-statusError" role="alert">
                  {error}
                </p>
              )}
              <button
                className="openMic-button openMic-buttonPrimary"
                type="submit"
                disabled={busy}
              >
                {busy ? 'Sending…' : 'Send application'}
              </button>
            </form>
          </>
        )}
      </dialog>
    </>
  );
}

function TestimonialsCarousel() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const slideCount = testimonials.length;

  function scrollToSlide(index: number, behavior?: ScrollBehavior) {
    const track = trackRef.current;
    if (!track) return;
    const slide = track.children[index] as HTMLElement | undefined;
    if (!slide) return;
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    track.scrollTo({
      left: slide.offsetLeft - track.offsetLeft,
      behavior: behavior ?? (prefersReducedMotion ? 'auto' : 'smooth'),
    });
  }

  function goToSlide(index: number) {
    const next = (index + slideCount) % slideCount;
    setActiveIndex(next);
    scrollToSlide(next);
  }

  function syncActiveSlide() {
    const track = trackRef.current;
    if (!track) return;
    const slides = Array.from(track.children) as HTMLElement[];
    const trackMiddle = track.scrollLeft + track.clientWidth / 2;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    slides.forEach((slide, index) => {
      const slideMiddle =
        slide.offsetLeft - track.offsetLeft + slide.clientWidth / 2;
      const distance = Math.abs(slideMiddle - trackMiddle);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    setActiveIndex(closestIndex);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goToSlide(activeIndex + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goToSlide(activeIndex - 1);
    }
  }

  return (
    <div
      className="openMic-carousel"
      role="group"
      aria-roledescription="carousel"
      aria-label="Artist testimonials"
      onKeyDown={handleKeyDown}
    >
      <div
        className="openMic-carouselTrack"
        ref={trackRef}
        onScroll={syncActiveSlide}
        tabIndex={0}
      >
        {testimonials.map((item, index) => (
          <article
            className="openMic-testimonial"
            key={item.number}
            aria-roledescription="slide"
            aria-label={`${index + 1} of ${slideCount}`}
          >
            <div className="openMic-testimonialMedia">
              <Image
                src={`/service-details/stem-contest/${item.image}`}
                alt={item.alt}
                fill
                sizes="(max-width: 680px) 100vw, 46vw"
              />
              <span className="openMic-testimonialStamp">{item.edition}</span>
            </div>
            <figure className="openMic-testimonialBody">
              <span className="openMic-testimonialNumber">{item.number}</span>
              <blockquote>
                <p>{item.quote}</p>
              </blockquote>
              <figcaption>
                <strong>{item.name}</strong>
                <span>{item.role}</span>
              </figcaption>
              <p className="openMic-photoCredit">{item.credit}</p>
            </figure>
          </article>
        ))}
      </div>

      <div className="openMic-carouselNav">
        <div className="openMic-carouselControls">
          <button
            type="button"
            className="openMic-carouselButton"
            onClick={() => goToSlide(activeIndex - 1)}
            aria-label="Previous testimonial"
          >
            <span aria-hidden="true">←</span>
          </button>
          <button
            type="button"
            className="openMic-carouselButton"
            onClick={() => goToSlide(activeIndex + 1)}
            aria-label="Next testimonial"
          >
            <span aria-hidden="true">→</span>
          </button>
          <p className="openMic-carouselCounter" aria-live="polite">
            {String(activeIndex + 1).padStart(2, '0')} / {String(slideCount).padStart(2, '0')}
          </p>
        </div>
        <div className="openMic-carouselDots">
          {testimonials.map((item, index) => (
            <button
              key={item.number}
              type="button"
              className="openMic-carouselDot"
              onClick={() => goToSlide(index)}
              aria-label={`Show testimonial ${index + 1}: ${item.name}`}
              aria-current={index === activeIndex ? 'true' : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

type Props = { data: OpenMicEditionStepsData | null };

export default function OpenMicCompetitionView({ data }: Props) {
  return (
    <div className="openMicPage">
      <a className="openMic-skip" href="#main">Skip to content</a>
      <header className="openMic-header">
        <div className="openMic-wrap openMic-nav">
          <a className="openMic-brand" href="/">
            <svg aria-hidden="true" viewBox="0 0 48 54">
              <path d="M7 3 43 13v14L18 39v-9l14-7-25-7V3Zm0 20 13 4v13l23-10v13L7 53V23Z" />
            </svg>
            <span>SPOTLIGHT<small>Open Mic</small></span>
          </a>
          <nav aria-label="Programme navigation">
            <a href="#route">Competition route</a>
            <a href="#testimonials">Testimonials</a>
            <a href="#opportunities">Opportunities</a>
            <Link href="/service-details/stem-contest">STEM &amp; Tech <ArrowIcon /></Link>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="openMic-hero" aria-labelledby="openMic-title">
          <div className="openMic-wrap openMic-heroInner">
            <div className="openMic-heroCopy">
              <div className="openMic-edition">
                <span>SPOTLIGHT COMPETITIONS</span>
                <span>02 / ENTERTAINMENT</span>
              </div>
              <p className="openMic-kicker">01 / THE ENTERTAINMENT PILLAR</p>
              <h1 id="openMic-title">One beat.<br /><em>Make it yours.</em></h1>
              <p className="openMic-lead">
                Record an original song on the Spotlight beat. Share your entry,
                bring your audience and compete for ₦1 million, a studio session
                and a music video shoot.
              </p>
              <div className="openMic-actions">
                <a className="openMic-button openMic-buttonPrimary" href="/apply">
                  Register as an artist <ArrowIcon />
                </a>
                <a className="openMic-button openMic-buttonOutline" href="#route">
                  See how it works <ArrowIcon down />
                </a>
              </div>
            </div>
            <figure className="openMic-heroPhoto">
              <div className="openMic-heroFrame">
                <Image
                  src="/service-details/stem-contest/photo-spotlight-stage.webp"
                  alt="A performer with a microphone in the Spotlight photo archive."
                  fill
                  sizes="(max-width: 680px) 100vw, 50vw"
                  priority
                />
                <span className="openMic-heroLabel">PERFORMANCE ARCHIVE</span>
              </div>
              <figcaption className="openMic-heroCredit">
                A performer with a microphone in the Spotlight photo archive ·{' '}
                <a href="/">Spotlight photo archive</a>
              </figcaption>
            </figure>
          </div>
        </section>

        <div className="openMic-stats">
          <div className="openMic-wrap openMic-statsGrid">
            <div><strong>₦1M</strong><span>Monthly cash prize</span></div>
            <div><strong>1</strong><span>Studio recording session</span></div>
            <div><strong>1</strong><span>Music video shoot</span></div>
          </div>
        </div>

        <OpenMicEditionSteps data={data} />

        <section
          className="openMic-testimonials"
          id="testimonials"
          aria-labelledby="testimonials-title"
        >
          <div className="openMic-wrap openMic-sectionPad">
            <div className="openMic-testimonialsHead">
              <div>
                <p className="openMic-kicker">OPEN MIC / ARTIST VOICES</p>
                <h2 id="testimonials-title">Testimonials</h2>
              </div>
              <p className="openMic-sectionLead">
                Five artists describe the rounds, the feedback and the work that
                followed. Swipe through, or use the controls to move between
                voices.
              </p>
            </div>
            <TestimonialsCarousel />
            <p className="openMic-imageNote">
              Quotes are illustrative of the participant experience. Photographs
              are documentary references; each caption credits its original
              setting.
            </p>
          </div>
        </section>

        <section className="openMic-wrap openMic-sectionPad openMic-prep" id="prepare">
          <div>
            <p className="openMic-kicker">ENTRY PREPARATION</p>
            <h2>The artist’s release checklist</h2>
            <ol>
              <li><div><h3>Before you record</h3><p>Confirm you have the official beat for the round and review its permitted use.</p></div></li>
              <li><div><h3>Before you submit</h3><p>Check the entry requirements, audio format, credit information and deadline.</p></div></li>
              <li><div><h3>When voting opens</h3><p>Share the official entry link with peers and contacts. Include the song title, artist name and voting instructions.</p></div></li>
              <li><div><h3>If you win</h3><p>Plan the recording session for the entry song and choose which track you want to turn into a music video.</p></div></li>
            </ol>
          </div>
          <aside className="openMic-prepAside">
            <p className="openMic-kicker">PROGRAMME DESK</p>
            <h3>What lounge collaborators can host</h3>
            <div className="openMic-faq">
              <details><summary>Listening nights</summary><p>Play shortlisted tracks, introduce the artists and point guests to the official contest voting page.</p></details>
              <details><summary>Intimate showcases</summary><p>Offer a stage, a soundcheck and a format suited to emerging artists and your audience.</p></details>
              <details><summary>Community events</summary><p>Propose a local artist meetup or feedback session. Include your capacity, sound equipment, availability and contact details in the application.</p></details>
            </div>
          </aside>
        </section>

        <section className="openMic-paper" id="opportunities" aria-labelledby="prizes-title">
          <div className="openMic-wrap openMic-sectionPad">
            <p className="openMic-kicker">03 / THE MONTHLY WINNER</p>
            <h2 id="prizes-title">Make the next release count.</h2>
            <div className="openMic-prizes">
              {prizes.map((prize) => (
                <article key={prize.label}>
                  <b>{prize.label}</b>
                  <h3>{prize.title}</h3>
                  <p>{prize.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="openMic-wrap openMic-sectionPad openMic-lounges" id="lounges">
          <div className="openMic-seal openMic-loungeSeal">
            <span>SPOTLIGHT OPEN MIC</span>
            <strong>LIVE</strong>
            <span>THE LOUNGE NETWORK</span>
          </div>
          <div>
            <p className="openMic-kicker">04 / VENUE COLLABORATION</p>
            <h2>Give new voices a room.</h2>
            <p>Spotlight’s lounge programme is designed for listening sessions, artist showcases and local fan events. Participating venues can help bring the online contest into a live setting.</p>
            <p className="openMic-fine">Confirmed lounge names, locations and events will be listed here when Spotlight publishes the roster.</p>
            <div className="openMic-actions"><LoungeApplication /></div>
          </div>
        </section>

        <section className="openMic-media">
          <div className="openMic-wrap openMic-sectionPad">
            <p className="openMic-kicker">05 / ARTIST AND FAN DESK</p>
            <h2>Ready when your track is.</h2>
            <div className="openMic-faq">
              <details><summary>Where do I get the beat and submit my entry?</summary><p>Follow Spotlight’s official Open Mic instructions for the current beat, submission format and closing date. Start with the artist application link.</p></details>
              <details><summary>How do votes count toward selection?</summary><p>Share the official voting link once your entry is listed. Check the published rules for how voting and any judging contribute to the monthly result.</p></details>
              <details><summary>Can our lounge propose a showcase?</summary><p>Yes. Send your venue details, technical setup and proposed event format to Spotlight for review.</p></details>
            </div>
          </div>
        </section>

        <section className="openMic-closing">
          <div className="openMic-wrap openMic-sectionPad">
            <p className="openMic-kicker">YOUR NEXT MOVE</p>
            <h2>Ready to put your track out?</h2>
            <div className="openMic-actions">
              <a className="openMic-button openMic-buttonPrimary" href="/apply">
                Register as an artist <ArrowIcon />
              </a>
              <a className="openMic-button openMic-buttonOutline" href={data ? `/open-mic/${data.slug}/entries` : '/open-mic'}>
                Go to voting <ArrowIcon />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="openMic-footer">
        <div className="openMic-wrap openMic-footerInner">
          <strong>SPOTLIGHT / Open Mic</strong>
          <Link href="/service-details/stem-contest">Explore STEM &amp; Tech</Link>
          <a href="/contact">Contact Spotlight</a>
        </div>
      </footer>
    </div>
  );
}
