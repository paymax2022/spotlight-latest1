import Layout from "@/components/layout/Layout";
import { CardGrid, CtaBand, PageHero, SectionHeader } from '@/src/components/spotlight/site/Sections';
import { talentCategories } from '@/src/data/websiteExpansion';
import ContestsExplorer from '@/src/components/contests/ContestsExplorer';
import { getPublicContests } from '@/src/server/contests/public-contests';

export const dynamic = 'force-dynamic';

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

export default async function TalentVaultPage() {
  const contests = await getPublicContests();

  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <PageHero label="Talent Vault" title="Discover the Talents of Spotlight" subtitle="The Spotlight Talent Vault showcases contestants, finalists, performers, creators, innovators, and alumni discovered through Spotlight." ctas={[{ label: 'View Contests', href: '#contestants' }, { label: 'Apply to Join', href: '/apply', style: 'outline' }]} />
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Talent Categories" /><CardGrid items={talentCategories.map((item)=><p key={item}>{item}</p>)} /></section>
      <section id="contestants" className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <SectionHeader title="Contests" description="The same contests shown in the Spotlight app. Active contests are shown first; use the menu to see closed ones." />
        <ContestsExplorer contests={contests} />
      </section>
      <CtaBand title="Looking for Fresh Talent?" ctas={[{ label: 'Partner With Spotlight', href: '/sponsor' }, { label: 'Contact Talent Team', href: '/contact' }]} />
    </Layout>
  );
}
