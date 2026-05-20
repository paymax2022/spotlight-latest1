import Link from 'next/link';
import SpotlightShell from '@/src/components/spotlight/SpotlightShell';

export const metadata = {
  title: 'Sponsors & Partners | Spotlight',
  description: 'Partner with Spotlight for sponsor activation, youth engagement, and measurable empowerment impact.',
};

export default function SponsorsPartnersPage() {
  return (
    <SpotlightShell>
      <section className="max-w-6xl mx-auto px-4 md:px-8 py-16">
        <h1 className="font-display text-4xl md:text-6xl text-foreground">Sponsors & Partners</h1>
        <p className="text-foreground/70 mt-5 text-lg max-w-4xl">
          Spotlight offers a sponsor-integrated engagement ecosystem that turns attention into measurable brand and impact outcomes through reality content, youth programs, events, and digital campaigns.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/services/corporate-sponsorship-activation" className="btn-primary text-xs py-3 px-6">Sponsor Spotlight</Link>
          <Link href="/services/government-youth-empowerment-programs" className="btn-outline text-xs py-3 px-6">Government Partnership</Link>
          <Link href="/contact" className="btn-outline text-xs py-3 px-6">Book Partnership Meeting</Link>
        </div>
      </section>
    </SpotlightShell>
  );
}
