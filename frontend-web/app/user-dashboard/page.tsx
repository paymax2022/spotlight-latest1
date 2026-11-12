import type { Metadata } from 'next';
import Link from 'next/link';
import UserDashboardClient, { type Tab } from '@/components/user/UserDashboardClient';
import { ApplicationFooter, ApplicationHeader } from '@/components/season2/ShowChrome';
import { ArrowIcon } from '@/components/season2/Icons';
import { fontVariables } from '@/components/season2/applicationFonts';
import '@/components/season2/season2.css';
import '@/components/user/user-dashboard.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Home desk | Spotlight',
  description:
    'Your Spotlight account: drafts to finish, corrections to answer, calls closing soon and every service in one place.',
};

const TABS: readonly Tab[] = ['contests', 'applications', 'overview'];

function initialTab(params: Record<string, string | string[] | undefined>): Tab {
  const value = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  return TABS.includes(value as Tab) ? (value as Tab) : 'contests';
}

export default async function UserDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tab = initialTab(await searchParams);

  return (
    <div className={`sp-season2 sp-hub ${fontVariables}`}>
      <a className="skip" href="#dashboard">
        Skip to your dashboard
      </a>
      <ApplicationHeader />
      <main id="main">
        <section className="hub-hero wrap" aria-labelledby="dashboard-title">
          <div>
            <p className="eyebrow">
              <i></i> ACCOUNT <b></b> MEMBER DESK
            </p>
            <h1 id="dashboard-title">
              Home
              <br />
              <em>desk.</em>
            </h1>
          </div>
          <div className="hub-hero-copy">
            <p>
              Your open work in one place — drafts waiting for you, corrections to answer, calls
              closing this fortnight, and the rest of Spotlight one tap away.
            </p>
            <div className="actions">
              <Link className="button orange" href="/apply">
                Browse all programmes <ArrowIcon />
              </Link>
              <Link className="text-link" href="/season-2">
                Season 2 home <ArrowIcon />
              </Link>
            </div>
          </div>
        </section>

        <div id="dashboard" tabIndex={-1}>
          <UserDashboardClient initialTab={tab} />
        </div>
      </main>
      <ApplicationFooter />
    </div>
  );
}
