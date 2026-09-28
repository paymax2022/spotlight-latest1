import Layout from '@/components/layout/Layout';
import CrowdfundingContributionsClient from '@/src/components/crowdfunding/CrowdfundingContributionsClient';

export const dynamic = 'force-dynamic';

export default function CrowdfundingContributionsPage() {
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="My Contributions"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix">
        <div className="container">
          <CrowdfundingContributionsClient />
        </div>
      </section>
    </Layout>
  );
}
