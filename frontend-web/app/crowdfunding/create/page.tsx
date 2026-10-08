import Layout from '@/components/layout/Layout';
import CrowdfundingCreateClient from '@/src/components/crowdfunding/CrowdfundingCreateClient';

export const dynamic = 'force-dynamic';

export default function CrowdfundingCreatePage() {
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="Start a Campaign"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix">
        <div className="container">
          <CrowdfundingCreateClient />
        </div>
      </section>
    </Layout>
  );
}
