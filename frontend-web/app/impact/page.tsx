import SpotlightShell from '@/src/components/spotlight/SpotlightShell';
import { spotlightStats } from '@/src/data/services';

export const metadata = {
  title: 'Impact | Spotlight',
  description: 'Track Spotlight impact across youth participation, creative programs, partnerships, and media outcomes.',
};

export default function ImpactPage() {
  return (
    <SpotlightShell>
      <section className="max-w-6xl mx-auto px-4 md:px-8 py-16">
        <h1 className="font-display text-4xl md:text-6xl text-foreground">Impact</h1>
        <p className="text-foreground/70 mt-4 max-w-3xl">
          Spotlight is structured to generate measurable outcomes across youth development, creative economy activation, innovation, and institutional partnerships.
        </p>
        <div className="mt-8 grid grid-cols-2 md:grid-cols-3 gap-4">
          {spotlightStats.map((stat) => (
            <div key={stat.label} className="glass-card rounded-md p-5 text-center">
              <p className="font-display text-3xl text-accent-gold">{stat.value}</p>
              <p className="text-xs text-foreground/60 mt-2">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>
    </SpotlightShell>
  );
}
