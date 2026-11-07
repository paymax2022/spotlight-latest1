import Link from 'next/link';
import { ArrowIcon } from './Icons';
import { seasonFacts } from './content';

/**
 * The three campaign figures are the Season 2 page's own numbers, restated
 * here rather than invented for the layout
 * (app/season-2/page.tsx: 20-state auditions, 60 contestants, 60-day bootcamp).
 */
export default function Season() {
  return (
    <section className="season" aria-labelledby="season-title">
      <div className="wrap season-layout">
        <div className="season-label">
          <p className="eyebrow">THE REALITY TV SHOW</p>
          <div className="season-number" aria-hidden="true">
            S<span>02</span>
          </div>
          <span>THE NEXT CHAPTER</span>
        </div>
        <div className="season-copy">
          <p className="eyebrow">SPOTLIGHT / SEASON 2</p>
          <h2 id="season-title">
            Talent meets
            <br />
            <em>the bigger picture.</em>
          </h2>
          <p>
            Auditions. Bootcamp. Mentorship. Performances. A reality TV journey designed to help emerging talent grow
            beyond the first spotlight.
          </p>
          <Link className="text-link" href="/season-2">
            Explore Season 2 <ArrowIcon />
          </Link>
        </div>
        <div className="season-facts" aria-label="Season 2 campaign format">
          <p className="eyebrow">CAMPAIGN FORMAT</p>
          {seasonFacts.map((fact) => (
            <div key={fact.label}>
              <strong>{fact.value}</strong>
              <span>{fact.label}</span>
            </div>
          ))}
          <small>See the Season 2 page for the current rollout and application details.</small>
        </div>
      </div>
    </section>
  );
}
