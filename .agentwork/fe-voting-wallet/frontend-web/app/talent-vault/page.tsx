import Link from 'next/link';
import Layout from "@/components/layout/Layout";
import { CardGrid, CtaBand, PageHero, SectionHeader } from '@/src/components/spotlight/site/Sections';
import { talentCategories, talentSamples } from '@/src/data/websiteExpansion';

export const metadata = {
  title: 'Spotlight Talent Vault | Contestants, Finalists & Emerging Talents',
  description: 'Explore Spotlight Talent Vault — contestant profiles, finalists, performers, creators, innovators, actors, musicians, entrepreneurs, and emerging talents discovered through Spotlight.',
  alternates: { canonical: '/talent-vault' },
  openGraph: {
    title: 'Spotlight Talent Vault | Contestants, Finalists & Emerging Talents',
    description: 'Explore Spotlight Talent Vault — contestant profiles, finalists, performers, creators, innovators, actors, musicians, entrepreneurs, and emerging talents discovered through Spotlight.',
    url: '/talent-vault',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Spotlight Talent Vault | Contestants, Finalists & Emerging Talents',
    description: 'Explore Spotlight Talent Vault — contestant profiles, finalists, performers, creators, innovators, actors, musicians, entrepreneurs, and emerging talents discovered through Spotlight.',
  },
};

export default function TalentVaultPage() {
  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <PageHero label="Talent Vault" title="Discover the Talents of Spotlight" subtitle="The Spotlight Talent Vault showcases contestants, finalists, performers, creators, innovators, and alumni discovered through Spotlight." ctas={[{ label: 'View Contestants', href: '#contestants' }, { label: 'Apply to Join', href: '/apply', style: 'outline' }]} />
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Talent Categories" /><CardGrid items={talentCategories.map((item)=><p key={item}>{item}</p>)} /></section>
      <section id="contestants" className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <SectionHeader title="Contestant Cards" description="Sample placeholder data for replacement when production talent records are connected." />
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {talentSamples.map((talent) => (
            <article key={talent.slug} className="glass-card rounded-md p-5">
              <div className="w-16 h-16 rounded-full bg-bg border border-border mb-3" aria-hidden="true" />
              <p className="text-xs text-accent-gold">{talent.badge}</p>
              <h3 className="text-foreground font-semibold mt-1">{talent.name}</h3>
              <p className="text-sm text-foreground/70">{talent.stageName} • {talent.state} • {talent.category}</p>
              <p className="text-sm text-foreground/65 mt-2">{talent.bio}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/open-mic" className="btn-outline text-xs py-2 px-4">Vote</Link>
                <Link href={`/talent-vault/${talent.slug}`} className="btn-primary text-xs py-2 px-4">View Profile</Link>
              </div>
            </article>
          ))}
        </div>
      </section>
      <CtaBand title="Looking for Fresh Talent?" ctas={[{ label: 'Partner With Spotlight', href: '/sponsor' }, { label: 'Contact Talent Team', href: '/contact' }]} />
    </Layout>
  );
}
