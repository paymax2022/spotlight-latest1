import { ArrowIcon, SparkIcon } from './Icons';
import { LANDING_IMG } from './content';
import WorldNav from './WorldNav';

/**
 * The hero's photograph is a commissioned composite of the four worlds, not
 * documentation of an event, so the mock's "programme visualisation" credit is
 * kept on the frame.
 */
export default function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-top wrap">
        <div>
          <p className="eyebrow">
            <span className="pulse-dot" /> NIGERIAN TALENT. LIMITLESS POSSIBILITY.
          </p>
          <h1 id="hero-title">
            Your moment.
            <br />
            <span>Starts here.</span>
            <span className="title-star" aria-hidden="true">
              <SparkIcon />
            </span>
          </h1>
        </div>
        <div className="hero-aside">
          <span className="edition">ENTERTAINMENT / INNOVATION / SPORT / ENTERPRISE</span>
          <p>
            The stage. The lab. The court. The pitch.
            <br />{' '}
            Whatever your gift, there’s a place
            <br className="desktop-break" /> for it to shine.
          </p>
          <div className="hero-actions">
            <a className="button orange" href="#programmes">
              Explore your world <ArrowIcon />
            </a>
            <a className="text-link" href="#journey">
              How it works <span aria-hidden="true">↓</span>
            </a>
          </div>
        </div>
      </div>

      <div className="hero-frame">
        <div className="hero-image">
          <img
            src={`${LANDING_IMG}/spotlight-worlds.webp`}
            alt="Illustrative cinematic montage of Nigerian music, comedy and acting talent, tech innovators, indoor football players and an SME founder"
            fetchPriority="high"
            width={1774}
            height={887}
          />
          <div className="hero-shade" />
          <div className="frame-meta">
            <span>
              <i /> THIS IS WHAT POSSIBILITY LOOKS LIKE
            </span>
            <span>THE SPOTLIGHT UNIVERSE / 01</span>
          </div>
          <div className="image-credit">PROGRAMME VISUALISATION</div>
          <div className="hero-image-caption">
            <span>ONE PLATFORM.</span>
            <strong>So many ways to shine.</strong>
          </div>
        </div>
        <WorldNav />
      </div>

      <div className="hero-bottom wrap">
        <span>A PLATFORM FOR THE NEXT GENERATION</span>
        <p>Discover your talent. Develop your craft. Own your moment.</p>
        <a href="#programmes" aria-label="Scroll to programmes">
          <span>SCROLL TO EXPLORE</span> ↓
        </a>
      </div>
    </section>
  );
}
