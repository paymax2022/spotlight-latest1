import Link from 'next/link';
import Layout from '@/components/layout/Layout';
import { CardGrid, CtaBand, JourneyRoadmap, PageHero, SectionHeader } from '@/src/components/spotlight/site/Sections';
import { listContests } from '@/src/server/openmic/persistence';
import { hasUsableSupabaseConfig } from '@/src/lib/supabase/runtime';

export const dynamic = 'force-dynamic';

const journeySteps = [
  'Apply for the current monthly contest',
  'Download the official beat after approval',
  'Record and submit your original song',
  'Promote your entry and gather votes',
  'Top artists perform at the live finale',
];

const winnerPerks = [
  { title: 'Cash Prize', description: 'Take home the monthly cash prize as the top-voted artist.' },
  { title: 'Studio Session', description: 'A fully-funded professional studio session for your next record.' },
  { title: 'Music Video Support', description: 'Production support to bring your winning song to visual life.' },
  { title: 'Media Promotion', description: 'Featured across Spotlight media channels and partner platforms.' },
  { title: 'Label Consideration', description: 'A direct introduction to label and industry partners scouting talent.' },
];

export default async function OpenMicLandingPage() {
  const dbConfigured = hasUsableSupabaseConfig();
  const contests = await listContests({ includeNonPublic: true });

  return (
    <Layout
      headerStyle={1}
      footerStyle={1}
      onePageNav={false}
      breadcrumbTitle={null}
      breadcrumbClassName={undefined}
      breadcrumbPadding={undefined}
    >
      <PageHero
        label="Spotlight Open Mic"
        title="One Beat. One Song. One Shot."
        subtitle="Every month, Spotlight drops an official beat and emerging artists compete with original songs built on it. Apply, submit, gather votes, and qualify for the live monthly finale."
        ctas={[
          { label: 'Apply Now', href: '/apply' },
          { label: 'Open Artist Dashboard', href: '/open-mic/dashboard', style: 'outline' },
          { label: 'See Past Winners', href: '/open-mic/winners', style: 'outline' },
        ]}
      />

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <SectionHeader title="How It Works" description="Five steps from application to the live finale stage." />
        <JourneyRoadmap steps={journeySteps} />
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <SectionHeader title="Winner Perks" description="What the monthly winner walks away with." />
        <CardGrid
          items={winnerPerks.map((perk) => (
            <div key={perk.title}>
              <p className="text-xs uppercase tracking-wide text-accent-gold">{perk.title}</p>
              <p className="mt-2">{perk.description}</p>
            </div>
          ))}
        />
      </section>

      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <SectionHeader title="Current & Upcoming Editions" description="Open monthly contests you can apply to right now." />

        {!dbConfigured ? (
          <p className="mt-3 text-amber-700">
            Open Mic is database-driven and Supabase config is not active on this server instance.
          </p>
        ) : null}

        {contests.length === 0 ? (
          <div className="mt-5 glass-card rounded-md p-8 md:p-12 text-center">
            <p className="section-label">No Live Edition Right Now</p>
            <p className="font-display text-2xl text-foreground mt-3">The next beat drops soon</p>
            <p className="text-foreground/70 mt-3 max-w-xl mx-auto">
              We open a new monthly contest and release a fresh official beat on a rolling basis. Open your artist
              dashboard to be first in line the moment applications go live.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/open-mic/dashboard" className="btn-primary text-xs py-3 px-6">
                Open Artist Dashboard
              </Link>
              <Link href="/open-mic/winners" className="btn-outline text-xs py-3 px-6">
                See Past Winners
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4">
            {contests.map((contest) => (
              <div key={contest.id} className="glass-card rounded-md p-6 md:p-7">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-xl text-foreground">
                    <Link href={`/open-mic/${contest.slug}/apply`}>{contest.title}</Link>
                  </h3>
                  <span className="text-[11px] uppercase tracking-wide px-3 py-1 rounded-full border border-accent-gold/30 text-accent-gold">
                    {contest.status.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-foreground/70">
                  <p>Edition: {contest.month}/{contest.year}</p>
                  <p>
                    Registration:{' '}
                    {contest.entryFeeRequired
                      ? `Paid (NGN ${Number(contest.registrationFeeNgn || 0).toLocaleString('en-NG')})`
                      : 'Free'}
                  </p>
                  <p>
                    Registration Window:{' '}
                    {contest.registrationStartAt ? new Date(contest.registrationStartAt).toLocaleString() : 'TBA'} –{' '}
                    {contest.registrationEndAt ? new Date(contest.registrationEndAt).toLocaleString() : 'TBA'}
                  </p>
                  <p>
                    Submission Window:{' '}
                    {contest.submissionStartAt ? new Date(contest.submissionStartAt).toLocaleString() : 'TBA'} –{' '}
                    {contest.submissionEndAt ? new Date(contest.submissionEndAt).toLocaleString() : 'TBA'}
                  </p>
                  <p>Finale Venue: {contest.finale?.venueName ?? 'TBA'}</p>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Link href={`/open-mic/${contest.slug}/apply`} className="btn-primary text-xs py-3 px-6">
                    Apply Now
                  </Link>
                  <Link href={`/open-mic/${contest.slug}/enter`} className="btn-outline text-xs py-3 px-6">
                    Submit Song
                  </Link>
                  {contest.beat?.downloadUrl ? (
                    <Link href={`/open-mic/${contest.slug}/enter`} className="btn-outline text-xs py-3 px-6">
                      Download Beat
                    </Link>
                  ) : null}
                  <Link href={`/open-mic/${contest.slug}`} className="btn-outline text-xs py-3 px-6">
                    View Details
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <CtaBand
        title="Ready to Join?"
        text="Apply for this month's Open Mic contest and take your shot at the live finale."
        ctas={[
          { label: 'Apply Now', href: '/apply' },
          { label: 'My Open Mic Profile', href: '/open-mic/profile' },
        ]}
      />
    </Layout>
  );
}
