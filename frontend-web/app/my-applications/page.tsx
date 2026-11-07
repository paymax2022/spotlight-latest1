import type { Metadata } from 'next';
import Link from 'next/link';
import MyApplicationsClient from '@/components/user/MyApplicationsClient';
import { ApplicationFooter, ApplicationHeader } from '@/components/season2/ShowChrome';
import { ArrowIcon } from '@/components/season2/Icons';
import { fontVariables } from '@/components/season2/applicationFonts';
import '@/components/season2/season2.css';
import '@/components/season2/application.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My applications | Spotlight',
  description:
    'Continue a draft or check the status of an application you have submitted to Spotlight.',
};

export default function MyApplicationsPage() {
  return (
    <div className={`sp-season2 sp-apply ${fontVariables}`}>
      <a className="skip" href="#applications">
        Skip to your applications
      </a>
      <ApplicationHeader />
      <main id="main">
        <section className="apply-hero wrap" aria-labelledby="applications-title">
          <div>
            <p className="eyebrow">
              <i></i> ACCOUNT <b></b> APPLICATION LEDGER
            </p>
            <h1 id="applications-title">
              The call
              <br />
              <em>sheet.</em>
            </h1>
          </div>
          <div className="apply-hero-copy">
            <p>
              Every application you have started or submitted, newest first. Pick a draft up where
              you left it — each step was saved to your account.
            </p>
            <div className="actions">
              <Link className="button orange" href="/apply/reality-tv-show">
                Start an application <ArrowIcon />
              </Link>
              <Link className="text-link" href="/season-2">
                Season 2 home <ArrowIcon />
              </Link>
            </div>
          </div>
        </section>

        <section className="apply-body" id="applications" aria-label="Your applications">
          <div className="wrap">
            <MyApplicationsClient />
          </div>
        </section>
      </main>
      <ApplicationFooter />
    </div>
  );
}
