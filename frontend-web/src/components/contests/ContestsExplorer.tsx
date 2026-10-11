'use client';

import { useState } from 'react';
import {
  filterContests,
  type ContestFilter,
  type PublicContest,
} from '@/src/lib/contests/contest-filter';

// Fixed locale and zone so the server render and the browser agree on the text;
// the user's own timezone would otherwise cause a hydration mismatch.
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos',
  });

function ContestCard({ contest }: { contest: PublicContest }) {
  const isActive = contest.status === 'active';
  const when = contest.closesAt
    ? `${isActive ? 'Closes' : 'Closed'} ${formatDate(contest.closesAt)}`
    : null;

  return (
    <article className="glass-card rounded-md p-5">
      {/* The logo sits on the banner's lower-left corner, so the wrapper gets
          bottom margin for the part that hangs below it. */}
      <div className={`relative ${contest.logoUrl ? 'mb-9' : 'mb-3'}`}>
        {contest.bannerImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={contest.bannerImageUrl}
            alt=""
            className="w-full h-32 object-cover rounded-md border border-border"
          />
        ) : (
          <div
            data-testid="contest-banner-placeholder"
            className="w-full h-32 rounded-md bg-bg border border-border"
            aria-hidden="true"
          />
        )}
        {contest.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={contest.logoUrl}
            alt={`${contest.title} logo`}
            className="absolute -bottom-6 left-3 h-12 w-12 rounded-md border border-border bg-bg object-contain"
          />
        ) : null}
      </div>
      <p className="text-xs text-accent-gold uppercase">{isActive ? 'Active' : 'Closed'}</p>
      <h3 className="text-foreground font-semibold mt-1">{contest.title}</h3>
      {when ? <p className="text-sm text-foreground/70">{when}</p> : null}
      {contest.description ? (
        <p className="text-sm text-foreground/70 mt-1 line-clamp-2">{contest.description}</p>
      ) : null}
      {isActive ? (
        <div className="mt-4">
          {/* No web voting UI exists yet for Connect contests (mobile-only), so
              this stays informational rather than linking somewhere misleading. */}
          <p className="text-xs text-foreground/55">Vote in the Spotlight app</p>
        </div>
      ) : null}
    </article>
  );
}

export default function ContestsExplorer({
  contests,
  initialFilter = 'active',
}: {
  contests: PublicContest[];
  initialFilter?: ContestFilter;
}) {
  const [filter, setFilter] = useState<ContestFilter>(initialFilter);
  const visible = filterContests(contests, filter);

  return (
    <div>
      <div className="mt-5 flex items-center gap-3">
        <label htmlFor="contest-filter" className="text-sm text-foreground/70">
          Show
        </label>
        <select
          id="contest-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value === 'closed' ? 'closed' : 'active')}
          className="rounded-md border border-border bg-bg text-foreground text-sm px-3 py-2"
        >
          <option value="active">Active contests</option>
          <option value="closed">Closed contests</option>
        </select>
      </div>

      <div aria-live="polite">
        {visible.length === 0 ? (
          <p className="mt-5 text-sm text-foreground/65">
            {filter === 'active'
              ? 'No contests are open right now. Check back soon.'
              : 'No closed contests yet.'}
          </p>
        ) : (
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((contest) => (
              <ContestCard key={contest.id} contest={contest} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
