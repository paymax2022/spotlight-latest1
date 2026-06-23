import Layout from "@/components/layout/Layout";
import { CardGrid, CtaBand, PageHero, SectionHeader } from '@/src/components/spotlight/site/Sections';
import { studioCapabilities, studioServices } from '@/src/data/websiteExpansion';

export const metadata = {
  title: 'Spotlight Studios | Reality TV, Film, Music Video & Branded Content Production',
  description: 'Spotlight Studios produces reality TV, branded content, music videos, short films, feature films, documentaries, TV shows, commercials, behind-the-scenes content, and sponsor activation media.',
  alternates: { canonical: '/studios' },
  openGraph: {
    title: 'Spotlight Studios | Reality TV, Film, Music Video & Branded Content Production',
    description: 'Spotlight Studios produces reality TV, branded content, music videos, short films, feature films, documentaries, TV shows, commercials, behind-the-scenes content, and sponsor activation media.',
    url: '/studios',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Spotlight Studios | Reality TV, Film, Music Video & Branded Content Production',
    description: 'Spotlight Studios produces reality TV, branded content, music videos, short films, feature films, documentaries, TV shows, commercials, behind-the-scenes content, and sponsor activation media.',
  },
};

export default function StudiosPage() {
  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <PageHero label="Spotlight Studios" title="From Talent Discovery to Content Production" subtitle="Spotlight Studios turns talent, stories, brands, and campaigns into reality TV, film, music videos, branded content, documentaries, commercials, and social media assets." ctas={[{ label: 'Work With Spotlight Studios', href: '/contact' }, { label: 'View Production Services', href: '#services', style: 'outline' }]} />
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Production Capability" /><CardGrid items={studioCapabilities.map((item)=><p key={item}>{item}</p>)} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Why This Matters" description="Spotlight does not only discover talent. It can produce content around them, package them for brands, and create broadcast-ready and social-ready content for media partners, sponsors, and institutions." /></section>
      <section id="services" className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Services" /><CardGrid items={studioServices.map((item)=><p key={item}>{item}</p>)} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Content for Sponsors" /><CardGrid items={['Branded campaign videos','Product integration clips','Contestant stories','Social ads','Behind-the-scenes content','Influencer clips','Red carpet interviews','Corporate impact videos','CSR storytelling','Event recap videos'].map((item)=><p key={item}>{item}</p>)} /></section>
      <CtaBand title="Commission Premium Content Through Spotlight Studios" ctas={[{ label: 'Commission a Production', href: '/contact' }, { label: 'Partner With Spotlight Studios', href: '/sponsor' }]} />
    </Layout>
  );
}
