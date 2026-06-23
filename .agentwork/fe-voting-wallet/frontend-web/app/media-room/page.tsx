import Layout from "@/components/layout/Layout";
import { CardGrid, CtaBand, PageHero, SectionHeader } from '@/src/components/spotlight/site/Sections';
import { pressAssets } from '@/src/data/websiteExpansion';

export const metadata = {
  title: 'Spotlight Press & Media Room | News, Press Releases, Media Kit',
  description: 'Access Spotlight press releases, media kit, logo assets, show images, founder profile, trailers, media contacts, sponsor information, and news updates.',
  alternates: { canonical: '/media-room' },
  openGraph: {
    title: 'Spotlight Press & Media Room | News, Press Releases, Media Kit',
    description: 'Access Spotlight press releases, media kit, logo assets, show images, founder profile, trailers, media contacts, sponsor information, and news updates.',
    url: '/media-room',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Spotlight Press & Media Room | News, Press Releases, Media Kit',
    description: 'Access Spotlight press releases, media kit, logo assets, show images, founder profile, trailers, media contacts, sponsor information, and news updates.',
  },
};

export default function MediaRoomPage() {
  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <PageHero label="Press & Media" title="Spotlight Press & Media Room" subtitle="News, press releases, media assets, show information, founder profile, brand resources, and official contacts for journalists, sponsors, partners, and media organisations." ctas={[{ label: 'Download Media Kit', href: '#media-kit' }, { label: 'Contact Press Team', href: '/contact', style: 'outline' }]} />
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Latest News / Press Releases" /><CardGrid items={['Spotlight Season 2 Opens Partnership Conversations','Spotlight Announces 10-State Audition Plan','Spotlight Expands Youth Empowerment Through Music, Film, STEM and SME','Spotlight Builds Brand Partnership Platform for Season 2'].map((item)=><p key={item}>{item}</p>)} /></section>
      <section id="media-kit" className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Media Kit Downloads" /><div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">{pressAssets.map((item)=><div key={item} className="glass-card rounded-md p-5"><p className="text-foreground text-sm">{item}</p><button type="button" className="btn-outline text-xs py-2 px-4 mt-3" disabled>Download Coming Soon</button></div>)}</div></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Fast Facts" /><CardGrid items={['Brand: Spotlight Talent Hunt / Spotlight Reality TV Show','Founder: Patrick Egbuji','Focus: youth empowerment, entertainment, talent discovery, reality TV, creative economy','Season 2: 10-state auditions, 60 contestants, 60-day bootcamp','Format: auditions, bootcamp, weekly performances, voting, evictions, finale','Website: www.spotlightng.com','Contact: info@spotlightng.com','Phone: +234 806 343 7144'].map((item)=><p key={item}>{item}</p>)} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Media Contacts" /><CardGrid items={['Press inquiries: info@spotlightng.com','Sponsorship inquiries: info@spotlightng.com','Talent/application inquiries: info@spotlightng.com','Partnership inquiries: info@spotlightng.com'].map((item)=><p key={item}>{item}</p>)} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Press FAQ" /><CardGrid items={['What is Spotlight?','What is Season 2?','Who can apply?','How can sponsors partner?','How can media organisations collaborate?','Where can journalists get official images?','Who should be contacted for interviews?'].map((item)=><p key={item}>{item}</p>)} /></section>
      <CtaBand title="Request Interview or Media Access" ctas={[{ label: 'Request Interview', href: '/contact' }, { label: 'Contact Media Team', href: '/contact' }]} />
    </Layout>
  );
}
