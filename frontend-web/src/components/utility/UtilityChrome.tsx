import Link from 'next/link';

/**
 * The inline icon sprite and quiet aubergine chrome for the Utility desk. The
 * page renders these itself instead of the marketing Layout so the desk can
 * own the full viewport.
 */
export function UtilitySprite() {
  return (
    <svg width="0" height="0" className="u-defs" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="u-brand" x2="1" y2="1">
          <stop stopColor="#ffb24b" />
          <stop offset=".5" stopColor="#ff823b" />
          <stop offset="1" stopColor="#a548e4" />
        </linearGradient>
        <symbol id="u-mark" viewBox="0 0 48 54">
          <path fill="url(#u-brand)" d="M7 3 43 13v14L18 39v-9l14-7-25-7V3Zm0 20 13 4v13l23-10v13L7 53V23Z" />
        </symbol>
        <symbol id="u-arrow" viewBox="0 0 24 24">
          <path d="M4 12h15m-6-6 6 6-6 6" />
        </symbol>
        <symbol id="u-airtime" viewBox="0 0 24 24">
          <rect x="6" y="2.5" width="12" height="19" rx="3" />
          <path d="M10 6h4m-3 12h2" />
        </symbol>
        <symbol id="u-data" viewBox="0 0 24 24">
          <path d="M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-9 4a4 4 0 0 1 6 0m-3 4h.01" />
        </symbol>
        <symbol id="u-power" viewBox="0 0 24 24">
          <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" />
        </symbol>
        <symbol id="u-tv" viewBox="0 0 24 24">
          <rect x="3" y="6" width="18" height="13" rx="3" />
          <path d="m8 3 4 3 4-3m-6 7 5 2.5-5 2.5Z" />
        </symbol>
        <symbol id="u-internet" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="4" ry="9" />
          <path d="M3 12h18" />
        </symbol>
        <symbol id="u-education" viewBox="0 0 24 24">
          <path d="m2 9 10-5 10 5-10 5L2 9Zm4 2v6c4 3 8 3 12 0v-6m4-2v6" />
        </symbol>
        <symbol id="u-wallet" viewBox="0 0 24 24">
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="M21 10h-5a2 2 0 0 0 0 4h5m-5-2h.01" />
        </symbol>
      </defs>
    </svg>
  );
}

function Wordmark() {
  return (
    <Link className="u-wordmark" href="/" aria-label="Spotlight home">
      <svg aria-hidden="true">
        <use href="#u-mark" />
      </svg>
      <span>
        SPOTLIGHT
        <small>UTILITY</small>
      </span>
    </Link>
  );
}

export function UtilityHeader() {
  return (
    <header className="u-header">
      <div className="u-wrap u-nav">
        <Wordmark />
        <nav aria-label="Utility navigation">
          <a href="#payment">Pay bills</a>
          <a href="#activity">Activity</a>
          <a href="#help">Help</a>
        </nav>
        <Link className="u-wallet" href="/profile">
          <svg aria-hidden="true">
            <use href="#u-wallet" />
          </svg>
          Wallet &amp; profile
          <svg aria-hidden="true">
            <use href="#u-arrow" />
          </svg>
        </Link>
      </div>
    </header>
  );
}

export function UtilityFooter() {
  return (
    <footer className="u-footer">
      <div className="u-wrap u-foot">
        <Wordmark />
        <p>Spotlight Utility · Nigeria</p>
        <Link href="/privacy-policy">Privacy policy</Link>
      </div>
    </footer>
  );
}
