import Layout from '@/components/layout/Layout';
import EarnClient from '@/src/components/referral/EarnClient';
import { featureFlags } from '@/src/lib/feature-flags';

export const metadata = {
  title: 'Earn — Referral Rewards | Spotlight',
  description:
    'Invite friends to Spotlight and earn a share of the platform margin when they transact. Track your code, referrals, earnings and milestone bonuses.',
};

export default function EarnPage() {
  const enabled = featureFlags.referrals();
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={false}
      breadcrumbTitle="Earn"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix">
        <div className="container">
          {enabled ? (
            <EarnClient />
          ) : (
            <div className="py-5 text-center">
              <h4>Earn is coming soon</h4>
              <p className="text-muted">Referral rewards aren’t available yet. Check back shortly.</p>
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}
