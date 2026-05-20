import SpotlightShell from '@/src/components/spotlight/SpotlightShell';

export const metadata = {
  title: 'Media | Spotlight',
  description: 'Explore Spotlight media strength across reality TV, branded content, documentaries, and broadcast partnerships.',
};

export default function MediaPage() {
  const items = [
    'Reality TV content',
    'Talent showcase episodes',
    'Music performance content',
    'Film and series projects',
    'Youth empowerment documentaries',
    'Sponsor-branded campaign content',
    'Public-interest institutional content',
    'Broadcast-ready episodic programming',
  ];

  return (
    <SpotlightShell>
      <section className="max-w-6xl mx-auto px-4 md:px-8 py-16">
        <h1 className="font-display text-4xl md:text-6xl text-foreground">Media, Broadcast & Content Strength</h1>
        <p className="text-foreground/70 mt-4 max-w-3xl">
          Spotlight operates as a content engine for talent, institutions, sponsors, and public engagement stakeholders.
        </p>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((item) => (
            <div key={item} className="glass-card rounded-md p-4 text-sm text-foreground/75">{item}</div>
          ))}
        </div>
      </section>
    </SpotlightShell>
  );
}
