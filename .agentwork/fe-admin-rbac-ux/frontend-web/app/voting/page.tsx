import Layout from "@/components/layout/Layout";
import { CardGrid, CtaBand, PageHero, SectionHeader, TimelineSteps } from '@/src/components/spotlight/site/Sections';

export const metadata = {
  title: 'Spotlight Voting System | Public Voting, Evictions & Contestant Support',
  description: 'Learn how Spotlight voting works, including public voting, contestant support, prequalification, weekly evictions, vote transparency, anti-fraud protection, and voting rules.',
  alternates: { canonical: '/voting' },
  openGraph: {
    title: 'Spotlight Voting System | Public Voting, Evictions & Contestant Support',
    description: 'Learn how Spotlight voting works, including public voting, contestant support, prequalification, weekly evictions, vote transparency, anti-fraud protection, and voting rules.',
    url: '/voting',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Spotlight Voting System | Public Voting, Evictions & Contestant Support',
    description: 'Learn how Spotlight voting works, including public voting, contestant support, prequalification, weekly evictions, vote transparency, anti-fraud protection, and voting rules.',
  },
};

export default function VotingPage() {
  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <PageHero label="Voting" title="Support Your Favourite Talent" subtitle="Spotlight voting gives fans the power to support contestants, influence outcomes, and participate in the journey from audition to finale." ctas={[{ label: 'Vote Now', href: '/open-mic' }, { label: 'View Contestants', href: '/talent-vault', style: 'outline' }]} />
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="How Voting Works" /><TimelineSteps steps={['View Published Contestants','Select Contestant','Choose Vote Package','Confirm Vote','Track Contestant Progress','Share and Invite Supporters']} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Voting Phases" /><CardGrid items={['Prequalification Voting','Bootcamp Weekly Voting','Eviction Save Voting','Finale Voting','Special Sponsor Voting Challenges'].map((item)=><p key={item}>{item}</p>)} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Voting Rules" /><CardGrid items={['Only active published contests can receive votes','Vote prices may vary by contest','Voting windows open and close based on admin schedule','Votes are final once confirmed','Suspicious voting may be flagged','Admin reserves right to audit results','Public leaderboard may be enabled or disabled depending on contest rules','Judges’ scores may be combined with public voting where applicable'].map((item)=><p key={item}>{item}</p>)} /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Transparency and Anti-Fraud" description="Spotlight will use vote logs, transaction records, device/IP analysis where applicable, payment verification, admin audit tools, and suspicious activity review to protect the integrity of voting." /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Free and Paid Voting" description="Some contests may support free votes, paid votes, sponsor-supported votes, referral bonus votes, or voting packages depending on admin settings." /></section>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Fan Sharing" description="Fans can share contestant profiles, invite friends, use referral links, and support contestant campaigns." /></section>
      <CtaBand title="Support a Contestant Today" ctas={[{ label: 'Vote Now', href: '/open-mic' }, { label: 'View Contestants', href: '/talent-vault' }, { label: 'Read Voting Terms', href: '/terms-and-conditions' }]} />
    </Layout>
  );
}
