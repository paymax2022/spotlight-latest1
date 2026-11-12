'use client';

import Link from 'next/link';
import SponsorMeetingBookingModal from '@/components/sponsor/SponsorMeetingBookingModal';
import { RegistrationTrigger } from './RegistrationPanel';
import { footerLinks } from './content';

export default function SeasonFooter() {
  return (
    <footer>
      <div className="wrap">
        <span>SPOTLIGHT REALITY TV / SEASON 01 RECAP</span>
        <div>
          {footerLinks.slice(0, 2).map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
          <RegistrationTrigger>Season 2 registration</RegistrationTrigger>
          <SponsorMeetingBookingModal>Sponsorship enquiry</SponsorMeetingBookingModal>
          {footerLinks.slice(3).map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
