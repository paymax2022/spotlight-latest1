import Layout from "@/components/layout/Layout";
import { CardGrid, CtaBand, PageHero, SectionHeader, TimelineSteps } from '@/src/components/spotlight/site/Sections';
import Season2ApplicationForm from '@/src/components/spotlight/site/Season2ApplicationForm';
import { applyCategories, applyEligibility, applyFaqs, applyJourney } from '@/src/data/websiteExpansion';

export const metadata = {
  title: 'Apply for Spotlight Season 2 | Talent Hunt Registration',
  description: 'Apply for Spotlight Season 2. Register for auditions, talent categories, bootcamp consideration, public voting, and national reality TV exposure.',
  alternates: { canonical: '/apply' },
  openGraph: {
    title: 'Apply for Spotlight Season 2 | Talent Hunt Registration',
    description: 'Apply for Spotlight Season 2. Register for auditions, talent categories, bootcamp consideration, public voting, and national reality TV exposure.',
    url: '/apply',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Apply for Spotlight Season 2 | Talent Hunt Registration',
    description: 'Apply for Spotlight Season 2. Register for auditions, talent categories, bootcamp consideration, public voting, and national reality TV exposure.',
  },
};

export default function ApplyPage() {
  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <PageHero label="Apply / Register" title="Apply for Spotlight Season 2" subtitle="Start your journey from raw talent to national visibility." ctas={[{ label: 'Start Application', href: '#application-form' }]} />
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Who Can Apply?" /><CardGrid items={applyEligibility.map((item)=><p key={item}>{item}</p>)} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Application Categories" /><CardGrid items={applyCategories.map((item)=><p key={item}>{item}</p>)} /></section>
      <section id="application-form" className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <SectionHeader title="Required Information" description="Frontend form only for now. TODO: Connect this payload to the registration backend endpoint when finalized." />
        <Season2ApplicationForm />
      </section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Application Journey" /><TimelineSteps steps={applyJourney} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="FAQs" /><CardGrid items={applyFaqs.map((item)=><p key={item}>{item}</p>)} /></section>
      <CtaBand title="Ready to Be Seen Nationally?" ctas={[{ label: 'Start Application', href: '#application-form' }]} />
    </Layout>
  );
}
