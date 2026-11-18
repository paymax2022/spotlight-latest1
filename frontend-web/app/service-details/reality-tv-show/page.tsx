'use client';

import Layout from '@/components/layout/Layout';
import { Barlow_Condensed, DM_Sans, Manrope } from 'next/font/google';

const displayFont = Barlow_Condensed({
  weight: ['600', '700', '800'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-barlow-condensed',
});
const bodyFont = DM_Sans({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-dm-sans',
});
const headingFont = Manrope({
  weight: ['500', '600', '700', '800'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-manrope',
});

const routeStages = [
  {
    id: 'state',
    step: '01',
    label: 'Statewide auditions',
    text: 'Apply through Spotlight and choose your discipline. Check the Season 2 page for your state’s announced schedule, eligibility and audition instructions. Prepare one strong piece and be ready for a short introduction or follow-up.',
    link: '/season-2',
    linkText: 'Check the Season 2 rollout ↗',
  },
  {
    id: 'region',
    step: '02',
    label: 'Regional contests',
    text: 'Shortlisted state auditionees progress to regional competition. Performers present a refined piece and respond to feedback, with progression determined under the published competition rules.',
    link: null,
    linkText: null,
  },
  {
    id: 'mansion',
    step: '03',
    label: 'The mansion and bootcamp',
    text: 'Housemates rehearse with coaches, learn from industry guests and face solo and group challenges. Weekly performances, public voting and evictions are part of the show format. Follow the official season updates for the voting and progression rules.',
    link: null,
    linkText: null,
  },
  {
    id: 'finale',
    step: '04',
    label: 'The national championship',
    text: 'Finalists perform on the national stage in their disciplines. The finale brings together contestant performances, guest artists and recognition for standout talent. Follow the season announcements for the final format and awards.',
    link: null,
    linkText: null,
  },
  {
    id: 'career',
    step: '05',
    label: 'Industry introductions',
    text: 'Selected talent may be introduced to labels, studios, mentors and management teams. Each commercial opportunity is subject to selection and a separate agreement.',
    link: '#industry',
    linkText: 'Explore the career pathways ↓',
  },
];

const mediaCards = [
  {
    span: '01 / PAY TV',
    title: 'Satellite and digital TV',
    text: 'Explore episode and finale carriage through platforms such as DStv / GOtv, subject to agreement.',
  },
  {
    span: '02 / TERRESTRIAL & RADIO',
    title: 'Private, federal and state media',
    text: 'Use regional interviews, audition coverage and highlights to connect national programming with local audiences.',
  },
  {
    span: '03 / ON DEMAND',
    title: 'VoD and social video',
    text: 'Proposed formats include catch-up episodes, performance cuts, backstage diaries and contestant profiles where rights allow.',
  },
];

const industryCards = [
  {
    num: '01',
    title: 'Record label pathways',
    text: 'Introduce selected recording artists to established labels and producers for A&R review, recording and potential release discussions.',
  },
  {
    num: '02',
    title: 'Film and production studios',
    text: 'Help actors prepare showreels and connect with studio teams, casting professionals and screen production opportunities.',
  },
  {
    num: '03',
    title: 'Mentors and industry experts',
    text: 'Connect talent with working performers, directors, producers and coaches for feedback, introductions and career guidance.',
  },
  {
    num: '04',
    title: 'Artist management and promotion',
    text: 'Explore management representation, publicity, digital content, live bookings and brand opportunities suited to each performer.',
  },
];

const galleryItems = [
  { src: '/assets/reality-tv-show/house.webp', alt: 'Yvonne Jegede visits the Spotlight mansion', fig: '01 / Yvonne Jegede visits the mansion' },
  { src: '/assets/reality-tv-show/patron-visit.webp', alt: 'Spotlight housemates visit patron Larry Gaaga', fig: '02 / Housemates visit patron Larry Gaaga' },
  { src: '/assets/reality-tv-show/faze.webp', alt: 'Faze performs at the Spotlight grand finale', fig: '03 / Faze at the grand finale' },
  { src: '/assets/reality-tv-show/stage.webp', alt: 'Spotlight artists perform on stage', fig: '04 / Spotlight artists on stage' },
];

export default function RealityTvShowPage() {
  return (
    <>
      <Layout
        headerStyle={1}
        footerStyle={2}
        onePageNav={false}
        breadcrumbTitle={null}
        breadcrumbClassName={undefined}
        breadcrumbPadding={undefined}
      >
        <div className={`reality-tv-page ${displayFont.variable} ${bodyFont.variable} ${headingFont.variable}`}>
          <a className="reality-tv-skip" href="#main">
            Skip to content
          </a>

          <main id="main">
          <section className="reality-tv-hero" aria-labelledby="hero-title">
            <img src="/assets/reality-tv-show/music.webp" alt="" fetchPriority="high" width={1536} height={1024} />
            <div className="reality-tv-wrap reality-tv-hero-inner">
              <p className="reality-tv-eyebrow">
                <i /> SPOTLIGHT REALITY TV / ENTERTAINMENT
              </p>
              <h1 id="hero-title">
                From your state{' '}
                <br />
                to the <em>national stage.</em>
              </h1>
              <p className="reality-tv-lead">
                Music, comedy and acting. A competition built to discover talent across Nigeria and help standout performers build a career beyond the finale.
              </p>
              <div className="reality-tv-actions">
                <a className="reality-tv-button reality-tv-button-primary" href="/season-2">
                  Apply to audition <span aria-hidden="true">↗</span>
                </a>
                <a className="reality-tv-button reality-tv-button-outline" href="#road">
                  Explore the audition route <span aria-hidden="true">↓</span>
                </a>
              </div>
            </div>
          </section>

          <div className="reality-tv-numbers">
            <div className="reality-tv-wrap reality-tv-numbers-grid">
              <div>
                <b>20</b>
                <span>
                  <i>States in the</i>
                  <i>audition campaign</i>
                </span>
              </div>
              <div>
                <b>60</b>
                <span>
                  <i>Housemates in</i>
                  <i>the format</i>
                </span>
              </div>
              <div>
                <b>60</b>
                <span>
                  <i>Days in</i>
                  <i>one mansion</i>
                </span>
              </div>
              <a href="/season-2">
                SEASON 2 FORMAT <span aria-hidden="true">↗</span>
                <small>See the official rollout</small>
              </a>
            </div>
          </div>

          <section className="reality-tv-paper" id="format">
            <div className="reality-tv-wrap reality-tv-pad">
              <div className="reality-tv-section-heading">
                <p className="reality-tv-eyebrow">
                  <i /> 01 / THE ENTERTAINMENT PILLAR
                </p>
                <h2>Three ways to take the stage.</h2>
                <p>
                  Artists enter through their strongest discipline. On the show, rehearsals, coaching and performance challenges test how they adapt, collaborate and perform under pressure.
                </p>
              </div>
              <div className="reality-tv-disciplines">
                <article>
                  <span>01 / MUSIC</span>
                  <h3>Own the mic.</h3>
                  <p>
                    Bring a song that shows your voice, musicality and stage presence. Develop your delivery through voice coaching and performance feedback.
                  </p>
                </article>
                <article>
                  <span>02 / COMEDY</span>
                  <h3>Work the room.</h3>
                  <p>
                    Bring original material and show your timing, point of view and ability to connect with an audience.
                  </p>
                </article>
                <article>
                  <span>03 / ACTING</span>
                  <h3>Make it believable.</h3>
                  <p>
                    Prepare a monologue or scene that shows range, character choices and how you take direction.
                  </p>
                </article>
              </div>
            </div>
          </section>

          <section id="road" className="reality-tv-wrap reality-tv-pad">
            <div className="reality-tv-section-heading">
              <p className="reality-tv-eyebrow">
                <i /> 02 / THE COMPETITION ROUTE
              </p>
              <h2>Follow the road to the finale.</h2>
              <p>
                Open a stage to see what happens, what performers should prepare, and where the next round leads.
              </p>
            </div>

            <nav className="reality-tv-infographic" aria-label="Competition stages">
              {routeStages.map((stage) => (
                <a key={stage.id} href={`#${stage.id}`}>
                  <span>{stage.step}</span>
                  {stage.label}
                </a>
              ))}
            </nav>

            <div className="reality-tv-route">
              {routeStages.map((stage) => (
                <details key={stage.id} id={stage.id} name="route" open={stage.id === 'state'}>
                  <summary>
                    <span>{stage.step}</span>
                    {stage.label}
                  </summary>
                  <div>
                    <p>{stage.text}</p>
                    {stage.link && <a href={stage.link}>{stage.linkText}</a>}
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section className="reality-tv-archive" id="archive">
            <div className="reality-tv-wrap reality-tv-pad">
              <div className="reality-tv-section-heading">
                <p className="reality-tv-eyebrow">
                  <i /> 03 / SEASON 1 ARCHIVE
                </p>
                <h2>Inside the mansion. On the stage.</h2>
                <p>Revisit moments from the first season, from industry encounters in the house to performances at the finale.</p>
              </div>
              <div className="reality-tv-photos">
                {galleryItems.map((item) => (
                  <figure key={item.src}>
                    <a href={item.src} data-gallery>
                      <img src={item.src} alt={item.alt} loading="lazy" />
                    </a>
                    <figcaption>{item.fig}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>

          <section id="industry" className="reality-tv-paper">
            <div className="reality-tv-wrap reality-tv-pad reality-tv-industry">
              <div className="reality-tv-section-heading">
                <p className="reality-tv-eyebrow">
                  <i /> 04 / BEYOND THE FINALE
                </p>
                <h2>Build a career after the show.</h2>
                <p>
                  Spotlight’s proposed industry pathways match performers with opportunities relevant to their craft. Deals depend on selection, partner participation and written terms.
                </p>
              </div>
              <div className="reality-tv-industry-list">
                {industryCards.map((item) => (
                  <article key={item.num}>
                    <span>{item.num}</span>
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.text}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section id="media" className="reality-tv-wrap reality-tv-pad">
            <div className="reality-tv-section-heading">
              <p className="reality-tv-eyebrow">
                <i /> 05 / MEDIA AND DISTRIBUTION
              </p>
              <h2>Take the performances to more screens.</h2>
              <p>
                Spotlight features DStv / GOtv, TVC Entertainment, WAP TV, Wazobia TV, Rave TV, MITV and Radio Nigeria / FRCN in its media network. Season-specific carriage and schedules are subject to confirmation.
              </p>
            </div>
            <div className="reality-tv-media-grid">
              {mediaCards.map((card) => (
                <article key={card.title}>
                  <span>{card.span}</span>
                  <h3>{card.title}</h3>
                  <p>{card.text}</p>
                </article>
              ))}
            </div>
            <a className="reality-tv-text-link" href="/sponsors-partners">
              Explore Spotlight’s partner network ↗
            </a>
          </section>

          <section className="reality-tv-closing">
            <div className="reality-tv-wrap reality-tv-pad">
              <p className="reality-tv-eyebrow">
                <i /> SEASON 2 / YOUR NEXT MOVE
              </p>
              <h2>Bring your best performance.</h2>
              <p>Check audition details, prepare your piece and take the first step.</p>
              <div className="reality-tv-actions">
                <a className="reality-tv-button reality-tv-button-primary" href="/season-2">
                  Apply to audition ↗
                </a>
                <a className="reality-tv-button reality-tv-button-outline" href="/sponsors-partners">
                  Partner with Spotlight ↗
                </a>
              </div>
            </div>
          </section>
        </main>
        </div>

        <style jsx global>{`
        .reality-tv-page {
          --dark: #150e1c;
          --plum: #24162d;
          --orange: #ff8949;
          --paper: #f2ece4;
          --ink: #261833;
          --light: var(--paper);
          --muted: #c8b9cf;
          --purple: #734687;
          --line: #ab83ba45;
          background: var(--dark);
          color: var(--light);
          font: 16px/1.65 var(--font-dm-sans), Arial, sans-serif;
        }

        .reality-tv-page * { box-sizing: border-box; }
        /* main.css paints every heading in the site header ink and title-cases
           it; both are unreadable on this page's dark bands. */
        .reality-tv-page h1, .reality-tv-page h2, .reality-tv-page h3 {
          color: inherit;
          text-transform: none;
        }
        .reality-tv-page h1, .reality-tv-page h2, .reality-tv-page h3, .reality-tv-page p, .reality-tv-page figure { margin: 0; }
        .reality-tv-page a { color: inherit; text-decoration: none; }
        .reality-tv-page button { font: inherit; cursor: pointer; }
        .reality-tv-page a:focus-visible, .reality-tv-page summary:focus-visible, .reality-tv-page button:focus-visible {
          outline: 3px solid #b36aec;
          outline-offset: 4px;
        }
        .reality-tv-page .reality-tv-wrap {
          width: min(1216px, calc(100% - 90px));
          margin-inline: auto;
        }
        .reality-tv-page .reality-tv-pad { padding-block: 78px; }
        .reality-tv-page .reality-tv-skip {
          position: fixed;
          z-index: 5;
          top: 10px;
          left: 10px;
          transform: translateY(-160%);
          background: var(--paper);
          color: var(--ink);
          padding: 10px;
        }
        .reality-tv-page .reality-tv-skip:focus { transform: none; }
        .reality-tv-page .reality-tv-text-link:hover { color: var(--orange); }
        .reality-tv-page .reality-tv-button {
          display: inline-flex;
          align-items: center;
          justify-content: space-between;
          gap: 13px;
          min-height: 46px;
          padding: 10px 15px;
          border: 1px solid transparent;
          border-radius: 4px;
          font: 800 12px/1.4 var(--font-manrope), Arial, sans-serif;
        }
        .reality-tv-page .reality-tv-button-outline {
          border-color: var(--line);
          background: rgba(36,22,45,0.6);
        }
        .reality-tv-page .reality-tv-button-outline:hover { background: #352141; }
        .reality-tv-page .reality-tv-button-primary {
          background: var(--orange);
          color: var(--dark);
        }
        .reality-tv-page .reality-tv-button-primary:hover { background: #ff9a61; }
        .reality-tv-page .reality-tv-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          background: var(--plum);
        }
        .reality-tv-page .reality-tv-hero > img,
        .reality-tv-page .reality-tv-hero:after {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          z-index: -1;
        }
        .reality-tv-page .reality-tv-hero > img {
          object-fit: cover;
          object-position: 70% 38%;
        }
        .reality-tv-page .reality-tv-hero:after {
          content: '';
          background: linear-gradient(90deg, #150e1c 2%, rgba(21,14,28,0.96) 24%, rgba(36,22,45,0.69) 48%, rgba(36,22,45,0.1) 87%), linear-gradient(0deg, rgba(21,14,28,0.8), transparent 30%);
        }
        .reality-tv-page .reality-tv-hero-inner { position: relative; padding-block: 105px 99px; }
        .reality-tv-page .reality-tv-eyebrow {
          display: flex;
          align-items: center;
          gap: 9px;
          font: 800 10px/1.6 var(--font-manrope), Arial, sans-serif;
          letter-spacing: 0.18em;
          color: #d2a8dc;
        }
        .reality-tv-page .reality-tv-eyebrow i {
          display: block;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--orange);
          flex: none;
        }
        .reality-tv-page .reality-tv-hero h1 {
          font: 800 clamp(70px, 8.4vw, 126px)/0.84 var(--font-barlow-condensed), Impact, "Arial Narrow", sans-serif;
          letter-spacing: -0.018em;
          text-transform: uppercase;
          margin: 20px 0 25px;
        }
        .reality-tv-page .reality-tv-hero h1 em { color: var(--orange); font-weight: 800; font-style: normal; }
        .reality-tv-page .reality-tv-lead {
          max-width: 450px;
          color: var(--muted);
          font-size: 15px;
        }
        .reality-tv-page .reality-tv-actions {
          display: flex;
          gap: 11px;
          flex-wrap: wrap;
          margin-top: 25px;
        }
        .reality-tv-page .reality-tv-numbers { background: var(--plum); border-block: 1px solid var(--line); }
        .reality-tv-page .reality-tv-numbers-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          align-items: stretch;
        }
        .reality-tv-page .reality-tv-numbers-grid > div,
        .reality-tv-page .reality-tv-numbers-grid > a {
          display: flex;
          gap: 13px;
          align-items: center;
          padding: 16px 16px 16px 0;
          border-right: 1px solid var(--line);
        }
        .reality-tv-page .reality-tv-numbers-grid > div:not(:first-child),
        .reality-tv-page .reality-tv-numbers-grid > a { padding-left: 20px; }
        .reality-tv-page .reality-tv-numbers-grid b {
          font: 800 clamp(58px, 9vw, 122px)/0.9 var(--font-barlow-condensed), Impact, "Arial Narrow", sans-serif;
          color: var(--orange);
        }
        .reality-tv-page .reality-tv-numbers-grid span {
          color: var(--muted);
          font-size: 12px;
        }
        /* main.css hides every <br> under 576px, so the label lines are elements */
        .reality-tv-page .reality-tv-numbers-grid span i {
          display: block;
          font-style: normal;
        }
        .reality-tv-page .reality-tv-numbers-grid > a {
          display: block;
          border: 0;
          align-self: center;
          font: 800 10px/1.5 var(--font-manrope), Arial, sans-serif;
          letter-spacing: 0.09em;
        }
        .reality-tv-page .reality-tv-numbers-grid > a span { margin-left: 5px; }
        .reality-tv-page .reality-tv-numbers-grid small {
          display: block;
          margin-top: 5px;
          font-weight: 500;
          color: var(--muted);
          letter-spacing: 0;
        }
        .reality-tv-page .reality-tv-paper { background: var(--paper); color: var(--ink); }
        .reality-tv-page .reality-tv-paper .reality-tv-eyebrow { color: #795384; }
        .reality-tv-page .reality-tv-paper .reality-tv-eyebrow i { background: var(--orange); }
        .reality-tv-page .reality-tv-section-heading { max-width: 770px; margin-bottom: 31px; }
        .reality-tv-page .reality-tv-section-heading h2,
        .reality-tv-page .reality-tv-closing h2 {
          font: 700 clamp(36px, 5vw, 65px)/1.02 var(--font-manrope), Arial, sans-serif;
          letter-spacing: -0.06em;
          margin: 11px 0 13px;
        }
        .reality-tv-page .reality-tv-closing h2 {
          font: 800 clamp(60px, 11vw, 145px)/0.9 var(--font-barlow-condensed), Impact, "Arial Narrow", sans-serif;
          letter-spacing: -0.02em;
          text-transform: uppercase;
        }
        .reality-tv-page .reality-tv-section-heading > p:last-child { max-width: 650px; color: var(--muted); }
        .reality-tv-page .reality-tv-paper .reality-tv-section-heading > p:last-child,
        .reality-tv-page .reality-tv-paper article p { color: #67556f; }
        .reality-tv-page .reality-tv-disciplines,
        .reality-tv-page .reality-tv-media-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 16px; }
        .reality-tv-page .reality-tv-disciplines article,
        .reality-tv-page .reality-tv-media-grid article { border-top: 2px solid #ad777c; padding: 17px 6px 0 0; }
        .reality-tv-page .reality-tv-disciplines article > span,
        .reality-tv-page .reality-tv-media-grid article > span {
          font-family: var(--font-manrope), Arial, sans-serif;
          font-size: 10px;
          letter-spacing: 0.14em;
          font-weight: 800;
          color: #754c80;
        }
        .reality-tv-page article h3 {
          font: 800 22px/1.2 var(--font-manrope), Arial, sans-serif;
          letter-spacing: -0.035em;
          margin: 5px 0;
        }
        .reality-tv-page article p { font-size: 14px; color: var(--muted); }
        .reality-tv-page .reality-tv-infographic {
          display: grid;
          grid-template-columns: repeat(5, minmax(0,1fr));
          border: 1px solid var(--line);
          border-radius: 8px;
          overflow: hidden;
          margin-bottom: 17px;
        }
        .reality-tv-page .reality-tv-infographic a {
          position: relative;
          display: grid;
          gap: 8px;
          padding: 16px 11px;
          border-right: 1px solid var(--line);
          font-size: 13px;
          font-weight: 720;
          background: #21172a;
        }
        .reality-tv-page .reality-tv-infographic a:last-child { border-right: 0; }
        .reality-tv-page .reality-tv-infographic a span {
          font: 700 30px/1 var(--font-barlow-condensed), Impact, "Arial Narrow", sans-serif;
          color: var(--orange);
        }
        .reality-tv-page .reality-tv-infographic a:hover,
        .reality-tv-page .reality-tv-infographic a[aria-current] {
          background: #3a2449;
          box-shadow: inset 0 -2px var(--orange);
        }
        .reality-tv-page .reality-tv-route { border-top: 1px solid var(--line); }
        .reality-tv-page .reality-tv-route details { border-bottom: 1px solid var(--line); }
        .reality-tv-page .reality-tv-route summary { cursor: pointer; list-style: none; }
        .reality-tv-page .reality-tv-route summary {
          display: flex;
          gap: 12px;
          align-items: center;
          padding: 14px 0;
          font-family: var(--font-manrope), Arial, sans-serif;
          font-weight: 720;
        }
        .reality-tv-page .reality-tv-route summary::-webkit-details-marker { display: none; }
        .reality-tv-page .reality-tv-route summary span { color: var(--orange); font-size: 11px; }
        .reality-tv-page .reality-tv-route summary:after {
          content: '+';
          margin-left: auto;
          font-size: 21px;
          color: var(--orange);
        }
        .reality-tv-page .reality-tv-route details[open] summary:after { content: '−'; }
        .reality-tv-page .reality-tv-route details > div {
          max-width: 760px;
          padding: 0 0 17px 27px;
          color: var(--muted);
          font-size: 14px;
        }
        .reality-tv-page .reality-tv-route details a,
        .reality-tv-page .reality-tv-text-link {
          display: inline-block;
          color: var(--orange);
          text-decoration: underline;
          text-underline-offset: 4px;
          margin-top: 10px;
          font: 700 12px/1.5 var(--font-manrope), Arial, sans-serif;
        }
        .reality-tv-page .reality-tv-archive { background: var(--plum); }
        .reality-tv-page .reality-tv-photos {
          display: grid;
          grid-template-columns: repeat(4, minmax(0,1fr));
          gap: 12px;
        }
        .reality-tv-page .reality-tv-photos a {
          display: block;
          overflow: hidden;
          background: #352141;
        }
        .reality-tv-page .reality-tv-photos img {
          width: 100%;
          aspect-ratio: 4 / 4.8;
          object-fit: cover;
          display: block;
          transition: transform 0.25s;
        }
        .reality-tv-page .reality-tv-photos a:hover img { transform: scale(1.035); }
        .reality-tv-page figcaption {
          font-family: var(--font-manrope), Arial, sans-serif;
          font-size: 12px;
          color: var(--muted);
          padding: 9px 0;
        }
        .reality-tv-page .reality-tv-industry {
          display: grid;
          grid-template-columns: 0.9fr 1.1fr;
          gap: 48px;
        }
        .reality-tv-page .reality-tv-industry-list { border-top: 1px solid #b6a8b7; }
        .reality-tv-page .reality-tv-industry-list article {
          display: flex;
          gap: 14px;
          border-bottom: 1px solid #c7b9c7;
          padding: 13px 0;
        }
        .reality-tv-page .reality-tv-industry-list article > span {
          font-size: 11px;
          color: #754c80;
          font-weight: 800;
          margin-top: 5px;
        }
        .reality-tv-page .reality-tv-industry-list h3 { margin: 0 0 4px; }
        .reality-tv-page .reality-tv-media-grid article { border-color: #9a6ea8; }
        .reality-tv-page .reality-tv-media-grid article > span { color: #d2a8dc; }
        .reality-tv-page .reality-tv-closing {
          background: #3d214a;
          border-top: 1px solid #795582;
        }
        .reality-tv-page .reality-tv-closing p:not(.reality-tv-eyebrow) { color: var(--muted); }

        @media (max-width: 850px) {
          .reality-tv-page .reality-tv-wrap { width: calc(100% - 44px); }
          .reality-tv-page .reality-tv-pad { padding-block: 54px; }
          .reality-tv-page .reality-tv-hero-inner { padding-block: 79px; }
          .reality-tv-page .reality-tv-industry { gap: 22px; }
        }

        @media (max-width: 620px) {
          .reality-tv-page .reality-tv-wrap { width: calc(100% - 30px); }
          .reality-tv-page .reality-tv-pad { padding-block: 42px; }
          .reality-tv-page .reality-tv-hero-inner { padding-block: 109px 55px; }
          .reality-tv-page .reality-tv-hero > img { object-position: 69% center; }
          .reality-tv-page .reality-tv-hero:after {
            background: linear-gradient(90deg, rgba(21,14,28,0.9), rgba(21,14,28,0.6)), linear-gradient(0deg, rgba(21,14,28,0.9), transparent 86%);
          }
          .reality-tv-page .reality-tv-hero h1 { font-size: clamp(55px, 12vw, 83px); }
          .reality-tv-page .reality-tv-lead { font-size: 13px; }
          .reality-tv-page .reality-tv-numbers-grid { grid-template-columns: 1fr 1fr; }
          .reality-tv-page .reality-tv-numbers-grid > div,
          .reality-tv-page .reality-tv-numbers-grid > a { padding: 10px !important; border-bottom: 1px solid var(--line); }
          .reality-tv-page .reality-tv-numbers-grid > div:nth-child(2) { border-right: 0; }
          .reality-tv-page .reality-tv-numbers-grid > div:nth-child(3),
          .reality-tv-page .reality-tv-numbers-grid > a { border-bottom: 0; }
          .reality-tv-page .reality-tv-disciplines,
          .reality-tv-page .reality-tv-media-grid,
          .reality-tv-page .reality-tv-industry { grid-template-columns: 1fr; }
          .reality-tv-page .reality-tv-industry { gap: 0; }
          .reality-tv-page .reality-tv-infographic { grid-template-columns: 1fr; }
          .reality-tv-page .reality-tv-infographic a {
            display: flex;
            align-items: center;
            border-right: 0;
            border-bottom: 1px solid var(--line);
            padding: 8px 10px;
          }
          .reality-tv-page .reality-tv-infographic a:last-child { border-bottom: 0; }
          .reality-tv-page .reality-tv-infographic a span { font-size: 23px; }
          .reality-tv-page .reality-tv-photos { grid-template-columns: 1fr 1fr; }
          .reality-tv-page .reality-tv-section-heading { margin-bottom: 22px; }
        }
      `}</style>
      </Layout>
    </>
  );
}
