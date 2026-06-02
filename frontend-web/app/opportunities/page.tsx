import Layout from '@/components/layout/Layout';
import OpportunitiesClient from '@/components/user/OpportunitiesClient';

export const dynamic = 'force-dynamic';

export default function OpportunitiesPage() {
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="Open Opportunities"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix bg-cover" style={{ backgroundImage: 'url("/assets/img/service/service-bg-2.jpg")' }}>
        <div className="container">
          <OpportunitiesClient />
        </div>
      </section>
    </Layout>
  );
}
