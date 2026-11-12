'use client';

import Link from 'next/link';
import SponsorMeetingBookingModal from '@/components/sponsor/SponsorMeetingBookingModal';
import { RegistrationTrigger } from './RegistrationPanel';
import { ArrowIcon } from './Icons';
import { lookBackPhotos, seasonStats } from './content';
import PhotoBand from './PhotoBand';

/**
 * The audition window comes from the recorded season, so this band says what the
 * database actually holds: dates once the team enters them, and an honest
 * "not set yet" until then.
 */
export default function SeasonTwoCta({ windowLabel, seasonName }: { windowLabel: string | null; seasonName: string | null }) {
  return (
    <section className="paper season-cta section" id="season-two" aria-labelledby="season-two-title">
      <div className="wrap">
        <p className="eyebrow">THE NEXT SEASON / SPOTLIGHT REALITY TV</p>
        <h2 id="season-two-title">
          Get ready for the
          <br />
          <em>ultimate showdown.</em>
        </h2>

        <dl className="stats">
          {seasonStats.map((stat) => (
            <div key={stat.label}>
              <dt>{stat.value}</dt>
              <dd>{stat.label}</dd>
            </div>
          ))}
        </dl>

        <h3 className="gallery-heading">A look back before you step in</h3>
        <PhotoBand label="Season 1 moments before Season 2 registration" photos={lookBackPhotos} />

        <aside className="gallery-invitation">
          <p>
            {windowLabel
              ? `Auditions ${seasonName ? `for ${seasonName}` : 'for the next season'}: ${windowLabel}.`
              : 'Audition dates for the next season are set by the Spotlight team and appear here as soon as they are recorded.'}
          </p>
          <RegistrationTrigger className="button orange">
            Register for Season 2 <ArrowIcon />
          </RegistrationTrigger>
        </aside>

        <div className="actions">
          <RegistrationTrigger className="button dark">
            Start your application <ArrowIcon />
          </RegistrationTrigger>
          <Link className="text-link" href="/my-applications">
            Continue an application <ArrowIcon />
          </Link>
          <SponsorMeetingBookingModal className="button sponsor-cta">
            Sponsor Season 2 <ArrowIcon />
          </SponsorMeetingBookingModal>
        </div>
      </div>
    </section>
  );
}
