import Link from 'next/link';
import SpotlightShell from '@/src/components/spotlight/SpotlightShell';

export const metadata = {
  title: 'Apply / Register | Spotlight',
  description: 'Apply to Spotlight programs and services across auditions, bootcamps, contests, and partnerships.',
};

const applyPaths = [
  ['Talent Hunt & Auditions', '/services/talent-hunt-auditions'],
  ['Music Bootcamp', '/services/music-bootcamp-artist-development'],
  ['Film Academy', '/services/film-academy-production'],
  ['STEM Innovation Contest', '/services/stem-innovation-contest'],
  ['SME Pitch Contest', '/services/sme-pitch-entrepreneurship'],
  ['Open Mic Competition', '/services/open-mic-competition'],
] as const;

export default function ApplyPage() {
  return (
    <SpotlightShell>
      <section className="max-w-6xl mx-auto px-4 md:px-8 py-16">
        <h1 className="font-display text-4xl md:text-6xl text-foreground">Apply / Register</h1>
        <p className="text-foreground/70 mt-4 max-w-3xl">
          Choose your preferred Spotlight pathway and submit your application.
        </p>
        <div className="mt-7 grid grid-cols-1 md:grid-cols-2 gap-4">
          {applyPaths.map(([label, href]) => (
            <Link key={href} href={href} className="glass-card rounded-md p-5 text-foreground font-semibold hover:border-gold transition-colors">
              {label}
            </Link>
          ))}
        </div>
      </section>
    </SpotlightShell>
  );
}
