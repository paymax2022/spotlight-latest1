import Layout from '@/components/layout/Layout';
import MyApplicationsClient from '@/components/user/MyApplicationsClient';

export const dynamic = 'force-dynamic';

export default function MyApplicationsPage() {
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="My Applications"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix bg-cover" style={{ backgroundImage: 'url("/assets/img/service/service-bg-2.jpg")' }}>
        <div className="container">
          <MyApplicationsClient />
        </div>
      </section>
    </Layout>
  );
}
