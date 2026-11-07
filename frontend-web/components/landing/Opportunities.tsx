import Link from 'next/link';
import { ArrowIcon } from './Icons';
import { LANDING_IMG } from './content';

/**
 * `academyFrom` is the cheapest tuition the live catalogue actually charges per
 * area of study, formatted for display, or null when the catalogue could not be
 * read — in which case the card keeps its plain copy rather than quoting a
 * number admissions may not honour.
 */
export default function Opportunities({ academyFrom }: { academyFrom: string | null }) {
  return (
    <section className="opportunities wrap" id="opportunities" aria-labelledby="opportunities-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">02 / THERE’S MORE TO YOUR STORY</p>
          <h2 id="opportunities-title">
            Start small.
            <br />
            <em>Dream in widescreen.</em>
          </h2>
        </div>
        <p className="supporting-copy">
          Your next chapter could begin with one performance.
          <br />
          Or one day on a film set.
        </p>
      </div>

      <div className="opportunity-grid">
        <article className="opportunity-card mic-card">
          <img
            src={`${LANDING_IMG}/music.webp`}
            alt="Illustrative Open Mic singer performing with a handheld microphone"
            loading="lazy"
            decoding="async"
            width={1536}
            height={1024}
          />
          <div className="card-shade" />
          <span className="card-top">
            <span>TAKE THE MIC</span>
            <span>01 / LIVE PERFORMANCE</span>
          </span>
          <div className="opportunity-copy">
            <p className="eyebrow">A STAGE FOR FRESH VOICES</p>
            <h3>
              Open Mic
              <br />
              Competition.
            </h3>
            <p>One mic. Your voice. Make your first impression count with a platform for emerging performers.</p>
            <Link className="button light" href="/service-details/open-mic-competition">
              Explore Open Mic <ArrowIcon />
            </Link>
          </div>
        </article>

        <article className="opportunity-card academy-card">
          <img
            src={`${LANDING_IMG}/film-academy.jpg`}
            alt="Illustrative director guiding actors on a Nigerian film set"
            loading="lazy"
            decoding="async"
            width={1536}
            height={1024}
          />
          <div className="card-shade" />
          <span className="card-top">
            <span>LEARN THE CRAFT</span>
            <span>02 / HANDS-ON TRAINING</span>
          </span>
          <div className="opportunity-copy">
            <p className="eyebrow">FROM PASSION TO THE BIG SCREEN</p>
            <h3>
              Spotlight
              <br />
              Film Academy.
            </h3>
            <p>
              Find your place in front of the lens or behind it. Develop your craft through practical filmmaking
              {academyFrom ? `, with tuition from ${academyFrom} per area of study` : ''}.
            </p>
            <Link className="button light" href="/service-details/film-academy">
              Discover the Academy <ArrowIcon />
            </Link>
          </div>
        </article>
      </div>
    </section>
  );
}
