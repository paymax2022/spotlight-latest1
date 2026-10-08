import Layout from '@/components/layout/Layout';
import CrowdfundingContributionDetailClient from '@/src/components/crowdfunding/CrowdfundingContributionDetailClient';

export const dynamic = 'force-dynamic';

export default async function CrowdfundingContributionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="Contribution"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix">
        <div className="container">
          <CrowdfundingContributionDetailClient contributionId={id} />
        </div>
      </section>
    </Layout>
  );
}
