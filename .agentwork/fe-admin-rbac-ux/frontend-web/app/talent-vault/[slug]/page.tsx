import { notFound } from 'next/navigation';
import Link from 'next/link';
import Layout from "@/components/layout/Layout"
import { talentSamples } from '@/src/data/websiteExpansion';

export default function TalentProfilePage({ params }: { params: { slug: string } }) {
  const talent = talentSamples.find((item) => item.slug === params.slug);
  if (!talent) notFound();

  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <section className="max-w-5xl mx-auto px-4 md:px-8 py-16">
        <div className="glass-card rounded-md p-8">
          <div className="w-20 h-20 rounded-full bg-bg border border-border mb-4" aria-hidden="true" />
          <h1 className="font-display text-4xl text-foreground">{talent.name}</h1>
          <p className="text-foreground/70 mt-2">{talent.stageName} • {talent.category} • {talent.state}</p>
          <p className="text-foreground/70 mt-4">{talent.bio}</p>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-foreground/75">
            <p>Talent story: Placeholder biography content for CMS or backend integration.</p>
            <p>Audition video: Placeholder link area.</p>
            <p>Performance videos: Placeholder link area.</p>
            <p>Achievements: Placeholder achievements list.</p>
            <p>Brand collaboration availability: Available on request.</p>
            <p>Social media links: To be connected from profile records.</p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="#" className="btn-primary text-xs py-3 px-6">Vote</Link>
            <Link href="#" className="btn-outline text-xs py-3 px-6">Share</Link>
            <Link href="/contact" className="btn-outline text-xs py-3 px-6">Booking / Contact</Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
