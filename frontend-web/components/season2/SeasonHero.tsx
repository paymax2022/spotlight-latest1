'use client';

import SponsorMeetingBookingModal from '@/components/sponsor/SponsorMeetingBookingModal';
import { RegistrationTrigger } from './RegistrationPanel';
import { SceneStrip } from './MansionChapters';
import { SEASON2_IMG } from './content';

const MONTAGE = `${SEASON2_IMG}/mansion-hero.webp`;

export default function SeasonHero() {
  return (
    <section className="mansion-hero wrap" aria-labelledby="hero-title">
      <div className="mansion-heading">
        <div>
          <p className="eyebrow">
            <i></i> SPOTLIGHT REALITY TV <b></b> SEASON 01 RECAP
          </p>
          <h1 id="hero-title">
            Inside the
            <br />
            <em>Spotlight mansion.</em>
          </h1>
        </div>
        <div className="mansion-intro">
          <p>
            They came to compete. Then came the rehearsals, the house tasks, the battles and the goodbyes. Relive the
            season from inside the house.
          </p>
          <div className="actions">
            <a className="button orange" href="#mansion">
              Explore Season 1 <span aria-hidden="true">↓</span>
            </a>
            <RegistrationTrigger className="text-link">Season 2 registration</RegistrationTrigger>
            <SponsorMeetingBookingModal className="text-link">Sponsor Season 2</SponsorMeetingBookingModal>
          </div>
        </div>
      </div>

      <figure className="montage">
        <img
          src={MONTAGE}
          alt="Illustrative montage of mansion life, voice coaching, house tasks, group battles, a farewell and a live singer"
          fetchPriority="high"
        />
      </figure>

      <SceneStrip />
    </section>
  );
}
