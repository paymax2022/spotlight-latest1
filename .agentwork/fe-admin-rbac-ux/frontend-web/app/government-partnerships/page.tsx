import Layout from "@/components/layout/Layout"
import { CardGrid, CtaBand, InfoTable, PageHero, SectionHeader } from '@/src/components/spotlight/site/Sections';
import { governmentAlignment, institutions } from '@/src/data/websiteExpansion';

export const metadata = {
  title: 'Government & Institutional Partnerships | Spotlight Youth Empowerment',
  description: 'Spotlight partners with government institutions, MDAs, development agencies, and public-sector stakeholders to advance youth empowerment, creative economy growth, digital skills, entrepreneurship, culture, and national development.',
  alternates: { canonical: '/government-partnerships' },
  openGraph: {
    title: 'Government & Institutional Partnerships | Spotlight Youth Empowerment',
    description: 'Spotlight partners with government institutions, MDAs, development agencies, and public-sector stakeholders to advance youth empowerment, creative economy growth, digital skills, entrepreneurship, culture, and national development.',
    url: '/government-partnerships',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Government & Institutional Partnerships | Spotlight Youth Empowerment',
    description: 'Spotlight partners with government institutions, MDAs, development agencies, and public-sector stakeholders to advance youth empowerment, creative economy growth, digital skills, entrepreneurship, culture, and national development.',
  },
};

export default function GovernmentPartnershipsPage() {
  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <PageHero label="Institutional Partnerships" title="Spotlight as a National Youth Empowerment Vehicle" subtitle="Entertainment is the hook. Empowerment is the mission. Spotlight helps institutions engage young people through talent discovery, training, media visibility, creative economy participation, STEM, entrepreneurship, and post-show development." ctas={[{ label: 'Discuss Institutional Partnership', href: '/contact' }, { label: 'Download Impact Brief', href: '/media-room', style: 'outline' }]} />
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Institutional Alignment" /><CardGrid items={governmentAlignment.map((item)=><p key={item}>{item}</p>)} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Relevant Institutions" /><CardGrid items={institutions.map((item)=><p key={item}>{item}</p>)} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="How Spotlight Supports Public Objectives" /><InfoTable headers={['Public Objective','Spotlight Delivery Model']} rows={[['Youth engagement','Auditions, bootcamp, public voting'],['Creative economy','Music, film, content, live events'],['Entrepreneurship','SME pitch, business mentorship'],['Digital skills','STEM, innovation, media production'],['Employment','Training, exposure, partnerships'],['Culture','National talent stories and regional representation'],['Social inclusion','Open participation and state-level auditions'],['Public communication','TV, radio, social media campaigns']]} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Partnership Models" /><CardGrid items={['Endorsement partnership','Media partnership','State audition host partnership','Youth empowerment sponsorship','Skills training collaboration','Creative economy programme partnership','Content barter / national youth showcase','Grants and empowerment support','Institutional co-branding','Impact reporting partnership'].map((item)=><p key={item}>{item}</p>)} /></section>
      <CtaBand title="Build a Public Impact Partnership With Spotlight" ctas={[{ label: 'Book Institutional Meeting', href: '/contact' }]} />
    </Layout>
  );
}
