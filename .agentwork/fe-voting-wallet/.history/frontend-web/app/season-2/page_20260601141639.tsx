import Layout from "@/components/layout/Layout";
import { CardGrid, CtaBand, JourneyRoadmap, PageHero, SectionHeader } from '@/src/components/spotlight/site/Sections';
import { season2Journey, season2Pillars, season2Snapshot } from '@/src/data/websiteExpansion';

export const metadata = {
  title: 'Spotlight Season 2 | Talent Hunt, Bootcamp & Reality TV Show',
  description:
    'Discover Spotlight Season 2 — a national talent hunt and reality TV platform featuring 10-state auditions, 60 contestants, a 60-day bootcamp, public voting, weekly performances, mentorship, evictions, brand activations, and grand finale.',
  alternates: { canonical: '/season-2' },
  openGraph: { title: 'Spotlight Season 2 | Talent Hunt, Bootcamp & Reality TV Show', description: 'Discover Spotlight Season 2 — a national talent hunt and reality TV platform featuring 10-state auditions, 60 contestants, a 60-day bootcamp, public voting, weekly performances, mentorship, evictions, brand activations, and grand finale.', url: '/season-2' },
  twitter: { card: 'summary_large_image', title: 'Spotlight Season 2 | Talent Hunt, Bootcamp & Reality TV Show', description: 'Discover Spotlight Season 2 — a national talent hunt and reality TV platform featuring 10-state auditions, 60 contestants, a 60-day bootcamp, public voting, weekly performances, mentorship, evictions, brand activations, and grand finale.' },
};

export default function Season2Page() {
  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <PageHero label="Season 2" title="From Audition to Stardom" subtitle="20-State Auditions. 60 Contestants. 60-Day Bootcamp. Public Voting. Reality TV. Grand Finale. Spotlight Season 2 is a national youth entertainment and empowerment campaign designed to discover, develop, promote, and connect emerging talents through auditions, bootcamp training, reality TV exposure, public voting, brand partnerships, and post-show career opportunities." ctas={[{ label: 'Apply Now', href: '/apply' }, { label: 'Become a Sponsor', href: '/sponsor', style: 'outline' }, { label: 'View Voting Process', href: '/voting', style: 'outline' }]} heroImage={{ src: '/assets/img/shape/flyer3.png', alt: 'Spotlight Season 2 campaign visual' }} />
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Campaign Snapshot" /><CardGrid items={season2Snapshot.map((item) => <p key={item}>{item}</p>)} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Contestant Journey" /><JourneyRoadmap steps={season2Journey} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Season 2 Pillars" /><CardGrid items={season2Pillars.map((item) => <p key={item}>{item}</p>)} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Why Season 2 Matters" description="Spotlight Season 2 is more than a show. It is a national youth empowerment engine, a media property, a brand activation platform, a talent discovery pipeline, and a content production ecosystem." /></section>
      <CtaBand title="Put Your Brand Inside the Journey" text="Season 2 gives brands the opportunity to convert entertainment attention into customer acquisition, product activation, public trust, youth loyalty, sales engagement, and measurable ROI." ctas={[{ label: 'Sponsor Partnership', href: '/sponsor' }]} />
      <CtaBand title="Do You Have the Talent?" ctas={[{ label: 'Apply/Register', href: '/apply' }]} />
    </Layout>
  );
}
