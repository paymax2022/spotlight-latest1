import Layout from "@/components/layout/Layout";
import Link from "next/link";
import { CardGrid, CtaBand, InfoTable, SectionHeader } from '@/src/components/spotlight/site/Sections';
import { activationExamples, sponsorCategories } from '@/src/data/websiteExpansion';

export const metadata = {
  title: 'Sponsor Spotlight Season 2 | Brand Partnership & Activation',
  description: 'Partner with Spotlight Season 2 and convert entertainment attention into customer acquisition, product activation, public trust, youth engagement, sales conversion, and measurable ROI.',
  alternates: { canonical: '/sponsor' },
  openGraph: {
    title: 'Sponsor Spotlight Season 2 | Brand Partnership & Activation',
    description: 'Partner with Spotlight Season 2 and convert entertainment attention into customer acquisition, product activation, public trust, youth engagement, sales conversion, and measurable ROI.',
    url: '/sponsor',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sponsor Spotlight Season 2 | Brand Partnership & Activation',
    description: 'Partner with Spotlight Season 2 and convert entertainment attention into customer acquisition, product activation, public trust, youth engagement, sales conversion, and measurable ROI.',
  },
};

const snapshotRows = [
  ['20-state auditions', 'State-by-state activation and market access'],
  ['60 contestants', 'Brand storytelling and contestant-led campaigns'],
  ['60-day bootcamp', 'Recurring content and product integration'],
  ['Weekly performances', 'Sponsored segments and fan engagement'],
  ['Public voting', 'Repeated consumer interaction'],
  ['Media amplification', 'TV/radio/social reach'],
  ['Live events/finale', 'Product experience and premium visibility'],
  ['Post-season reporting', 'Measurable ROI/impact insights'],
];

const sponsorObjectives = [
  'Customer Acquisition',
  'Product Trial',
  'App Downloads',
  'Sales Conversion',
  'Lead Generation',
  'Brand Trust',
  'Youth Market Penetration',
  'Social Media Engagement',
  'Community Activation',
  'Data Capture',
  'Loyalty and Advocacy',
  'CSR / Youth Empowerment',
];

export default function SponsorPage() {
  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <section className="relative overflow-hidden border-b border-border/50">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,75,255,0.16),transparent_45%)]" />
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-16 md:py-24 relative">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            <div>
              <p className="section-label">Sponsor Partnership</p>
              <h1 className="font-display text-4xl md:text-6xl text-foreground mt-4">
                Move Beyond Visibility. Own the Attention.
              </h1>
              <p className="text-foreground/70 text-lg mt-5 leading-relaxed">
                Spotlight helps brands convert entertainment attention into customer acquisition, product activation, public trust, youth loyalty, data, sales engagement, and measurable ROI.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3 max-w-md">
                <div className="glass-card rounded-md p-3">
                  <p className="text-xs text-foreground/60">Audition Reach</p>
                  <p className="text-2xl font-display text-foreground">20 States</p>
                </div>
                <div className="glass-card rounded-md p-3">
                  <p className="text-xs text-foreground/60">Contestants</p>
                  <p className="text-2xl font-display text-foreground">60 Talents</p>
                </div>
              </div>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/media-room" className="btn-primary text-xs py-3 px-6">Request Sponsorship Deck</Link>
                <Link href="/contact" className="btn-outline text-xs py-3 px-6">Book Partnership Meeting</Link>
                <Link href="#categories" className="btn-outline text-xs py-3 px-6">View Sponsor Categories</Link>
              </div>
            </div>
            <div className="glass-card rounded-md p-3 md:p-4">
              <img
                src="/assets/img/shape/sponsor.png"
                alt="Spotlight sponsor banner"
                className="w-full h-[260px] md:h-[360px] object-cover rounded-md"
              />
            </div>
          </div>
        </div>
      </section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-10">
        <SectionHeader
          title="Why Brands Partner With Spotlight"
          description="Spotlight is a national youth engagement, media, entertainment, consumer activation, and conversion platform."
        />
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="glass-card rounded-md p-5">
            <p className="text-sm text-accent-gold uppercase tracking-wide">Reach</p>
            <p className="text-foreground mt-2">Multi-state audience coverage across on-ground activations, live events, and digital touchpoints.</p>
          </div>
          <div className="glass-card rounded-md p-5">
            <p className="text-sm text-accent-gold uppercase tracking-wide">Engagement</p>
            <p className="text-foreground mt-2">Weekly participation loops through performances, fan voting, and creator-led branded moments.</p>
          </div>
          <div className="glass-card rounded-md p-5">
            <p className="text-sm text-accent-gold uppercase tracking-wide">Outcomes</p>
            <p className="text-foreground mt-2">Conversion-oriented programs with reporting for acquisition, activation, and ROI visibility.</p>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <SectionHeader title="Season 2 Sponsor Snapshot" description="What sponsors plug into across the campaign lifecycle." />
        <InfoTable headers={['Campaign Asset', 'Sponsor Value']} rows={snapshotRows} />
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
          <div>
            <SectionHeader title="Sponsor Objectives" description="Select the outcomes you want us to prioritize in your package." />
            <CardGrid items={sponsorObjectives.map((item) => <p key={item}>{item}</p>)} />
          </div>
          <div id="categories">
            <SectionHeader title="Sponsorship Categories" description="Pick a model aligned with your budget, market, and growth targets." />
            <CardGrid items={sponsorCategories.map((item) => <p key={item}>{item}</p>)} />
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <SectionHeader title="Activation Examples" description="Ways brands are integrated into campaign moments and audience experiences." />
        <CardGrid items={activationExamples.map((item) => <p key={item}>{item}</p>)} />
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <SectionHeader title="KPI Framework" description="How performance is measured from awareness to conversion." />
        <InfoTable headers={['Deliverable Area', 'Measurement Focus']} rows={[['Media Visibility','TV/radio mentions, branded segments'],['Digital Reach','Impressions, views, shares, engagement'],['Customer Acquisition','Sign-ups, app downloads, leads'],['Product Activation','Sampling, demos, QR scans'],['Sales Engagement','Redemption codes, purchase campaigns'],['Voting-Linked Engagement','Fan participation, sponsor-linked voting'],['Event Activation','Booth traffic, audience engagement'],['Content Assets','Branded clips, contestant content'],['Reporting','Weekly reports and post-season ROI report']]} />
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <div className="glass-card rounded-md p-6 md:p-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div>
            <h3 className="font-display text-2xl md:text-3xl text-foreground">Ready to Build Your Sponsorship Model?</h3>
            <p className="text-foreground/70 mt-2 max-w-2xl">Share your target outcomes, budget direction, and timeline. We will map a sponsor package around your goals.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/contact" className="btn-primary text-xs py-3 px-6">Book Partnership Meeting</Link>
            <Link href="/media-room" className="btn-outline text-xs py-3 px-6">Request Sponsorship Deck</Link>
          </div>
        </div>
      </section>

      <CtaBand title="Let’s Build a Sponsor Model Around Your Business Objectives" ctas={[{ label: 'Book Partnership Meeting', href: '/contact' }]} />
    </Layout>
  );
}
