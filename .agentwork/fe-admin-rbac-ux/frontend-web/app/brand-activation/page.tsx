import Layout from "@/components/layout/Layout"
import { CardGrid, CtaBand, InfoTable, PageHero, SectionHeader } from '@/src/components/spotlight/site/Sections';

export const metadata = {
  title: 'Brand Activation With Spotlight | Sponsorship, Product Integration & Consumer Engagement',
  description: 'Explore how brands can activate through Spotlight using auditions, bootcamp challenges, sponsored segments, public voting, product sampling, QR campaigns, influencer content, grand finale ownership, and measurable ROI reporting.',
  alternates: { canonical: '/brand-activation' },
  openGraph: {
    title: 'Brand Activation With Spotlight | Sponsorship, Product Integration & Consumer Engagement',
    description: 'Explore how brands can activate through Spotlight using auditions, bootcamp challenges, sponsored segments, public voting, product sampling, QR campaigns, influencer content, grand finale ownership, and measurable ROI reporting.',
    url: '/brand-activation',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Brand Activation With Spotlight | Sponsorship, Product Integration & Consumer Engagement',
    description: 'Explore how brands can activate through Spotlight using auditions, bootcamp challenges, sponsored segments, public voting, product sampling, QR campaigns, influencer content, grand finale ownership, and measurable ROI reporting.',
  },
};

export default function BrandActivationPage() {
  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <PageHero label="Brand Activation" title="Turn Attention Into Action" subtitle="Spotlight helps brands move beyond logo visibility into customer acquisition, product trial, sales engagement, fan participation, and measurable ROI." ctas={[{ label: 'Explore Sponsorship', href: '/sponsor' }, { label: 'Book Brand Meeting', href: '/contact', style: 'outline' }]} />
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Activation Menu" /><CardGrid items={['10-State Audition Booths','Branded Bootcamp Challenges','Sponsored Weekly Segments','Product Sampling','QR Code Campaigns','App Download Campaigns','Shop-the-Look','Travel Promo Codes','Delivery Promo Codes','Fan Reward Campaigns','Voting-Linked Campaigns','Influencer Content','Contestant-Led Campaigns','Retail Redemption Campaigns','Grand Finale Ownership','Winner Empowerment Package'].map((item)=><p key={item}>{item}</p>)} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Industry Examples" /><CardGrid items={['Banking: account opening, savings campaign, youth banking, debit card adoption','Fintech: wallet activation, app downloads, QR payments, referral growth','Telecom: data bundles, SIM activation, streaming packages, youth digital traffic','FMCG: sampling, taste trials, retail activation, buy-and-win','Beauty: makeovers, shop-the-look, product trial, salon referrals','Airline: travel codes, finalist travel diaries, loyalty sign-ups','Logistics: delivery codes, merchandise delivery, SME onboarding','Gaming: age-gated responsible prediction, verified sign-ups, fan rewards','Government: youth empowerment, creative economy, state-level engagement'].map((item)=><p key={item}>{item}</p>)} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Measurement Framework" /><InfoTable headers={['Activation Type','Measurable Output']} rows={[['Sampling','Products distributed, leads captured'],['QR codes','Scans, sign-ups, conversions'],['Voting-linked','Votes, referrals, engagement'],['Retail promo','Redemptions, purchase interest'],['App campaign','Downloads, registrations'],['Social challenge','Posts, UGC, shares, reach'],['Finale event','Booth traffic, VIP engagement'],['Content','Views, impressions, watch time']]} /></section>
      <CtaBand title="Build My Brand Activation" ctas={[{ label: 'Build My Brand Activation', href: '/contact' }]} />
    </Layout>
  );
}
