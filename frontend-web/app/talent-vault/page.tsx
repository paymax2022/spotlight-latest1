import Layout from "@/components/layout/Layout";
import { CardGrid, CtaBand, PageHero, SectionHeader } from '@/src/components/spotlight/site/Sections';
import { talentCategories } from '@/src/data/websiteExpansion';
import { GO_BACKEND_URL } from '@/src/lib/go-backend';

export const dynamic = 'force-dynamic';

type Contest = {
  id: string;
  title: string;
  status: string;
  banner_image_url?: string;
  contestant_count: number;
  total_votes: number;
};

// Same data mobile shows signed-in users (GET /api/v1/connect/contests ->
// connect_contests), fetched here through the Go backend's public mirror of
// that route (backend/internal/connect/voting/handlers.go RegisterPublic)
// since this page renders for logged-out visitors. A client-side consumer
// would go through app/api/public/connect-contests/route.ts instead; a
// server component can call the Go backend directly and skip that hop.
async function getContests(): Promise<Contest[]> {
  try {
    const res = await fetch(`${GO_BACKEND_URL}/api/v1/public/contests`, { cache: 'no-store' });
    if (!res.ok) return [];
    const body = await res.json().catch(() => null);
    return Array.isArray(body?.data) ? body.data : [];
  } catch {
    // Go backend unreachable — render the page without the contest grid
    // rather than failing the whole marketing page.
    return [];
  }
}

export const metadata = {
  title: 'Spotlight Talent Vault | Contestants, Finalists & Emerging Talents',
  description: 'Explore Spotlight Talent Vault — contestant profiles, finalists, performers, creators, innovators, actors, musicians, entrepreneurs, and emerging talents discovered through Spotlight.',
  alternates: { canonical: '/talent-vault' },
  openGraph: {
    title: 'Spotlight Talent Vault | Contestants, Finalists & Emerging Talents',
    description: 'Explore Spotlight Talent Vault — contestant profiles, finalists, performers, creators, innovators, actors, musicians, entrepreneurs, and emerging talents discovered through Spotlight.',
    url: '/talent-vault',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Spotlight Talent Vault | Contestants, Finalists & Emerging Talents',
    description: 'Explore Spotlight Talent Vault — contestant profiles, finalists, performers, creators, innovators, actors, musicians, entrepreneurs, and emerging talents discovered through Spotlight.',
  },
};

export default async function TalentVaultPage() {
  const contests = await getContests();

  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <PageHero label="Talent Vault" title="Discover the Talents of Spotlight" subtitle="The Spotlight Talent Vault showcases contestants, finalists, performers, creators, innovators, and alumni discovered through Spotlight." ctas={[{ label: 'View Contests', href: '#contestants' }, { label: 'Apply to Join', href: '/apply', style: 'outline' }]} />
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-8"><SectionHeader title="Talent Categories" /><CardGrid items={talentCategories.map((item)=><p key={item}>{item}</p>)} /></section>
      <section id="contestants" className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <SectionHeader title="Live Contests" description="The same contests shown in the Spotlight app." />
        {contests.length === 0 ? (
          <p className="mt-5 text-sm text-foreground/65">No contests are open right now. Check back soon.</p>
        ) : (
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {contests.map((contest) => (
              <article key={contest.id} className="glass-card rounded-md p-5">
                {contest.banner_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={contest.banner_image_url}
                    alt=""
                    className="w-full h-32 object-cover rounded-md border border-border mb-3"
                  />
                ) : (
                  <div className="w-full h-32 rounded-md bg-bg border border-border mb-3" aria-hidden="true" />
                )}
                <p className="text-xs text-accent-gold uppercase">{contest.status}</p>
                <h3 className="text-foreground font-semibold mt-1">{contest.title}</h3>
                <p className="text-sm text-foreground/70">
                  {contest.contestant_count} contestant{contest.contestant_count === 1 ? '' : 's'} •{' '}
                  {contest.total_votes.toLocaleString()} vote{contest.total_votes === 1 ? '' : 's'}
                </p>
                <div className="mt-4">
                  {/* No web voting UI exists yet for Connect contests (mobile-only) —
                      an "/apply" or "/open-mic" link here would point at the wrong
                      flow entirely, so this stays informational rather than linking
                      somewhere misleading. */}
                  <p className="text-xs text-foreground/55">Vote in the Spotlight app</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <CtaBand title="Looking for Fresh Talent?" ctas={[{ label: 'Partner With Spotlight', href: '/sponsor' }, { label: 'Contact Talent Team', href: '/contact' }]} />
    </Layout>
  );
}
