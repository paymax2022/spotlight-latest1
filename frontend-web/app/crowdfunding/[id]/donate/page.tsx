import Layout from '@/components/layout/Layout';
import CrowdfundingDonateClient from '@/src/components/crowdfunding/CrowdfundingDonateClient';

export const dynamic = 'force-dynamic';

export default async function CrowdfundingDonatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="Contribute"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix">
        <div className="container">
          <CrowdfundingDonateClient campaignId={id} />
        </div>
      </section>
    </Layout>
  );
}
