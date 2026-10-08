import Layout from '@/components/layout/Layout';
import CrowdfundingDiscoveryClient from '@/src/components/crowdfunding/CrowdfundingDiscoveryClient';

export const dynamic = 'force-dynamic';

export default function CrowdfundingDiscoveryPage() {
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="Crowdfunding"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix">
        <div className="container">
          <CrowdfundingDiscoveryClient />
        </div>
      </section>
    </Layout>
  );
}
