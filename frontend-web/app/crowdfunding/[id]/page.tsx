import Layout from '@/components/layout/Layout';
import CrowdfundingDetailClient from '@/src/components/crowdfunding/CrowdfundingDetailClient';

export const dynamic = 'force-dynamic';

export default async function CrowdfundingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="Campaign"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix">
        <div className="container">
          <CrowdfundingDetailClient campaignId={id} />
        </div>
      </section>
    </Layout>
  );
}
