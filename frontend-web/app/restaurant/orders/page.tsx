import Layout from '@/components/layout/Layout';
import RestaurantOrdersClient from '@/src/components/restaurant/RestaurantOrdersClient';

export const dynamic = 'force-dynamic';

export default function RestaurantOrdersPage() {
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="My Food Orders"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix">
        <div className="container">
          <RestaurantOrdersClient />
        </div>
      </section>
    </Layout>
  );
}
