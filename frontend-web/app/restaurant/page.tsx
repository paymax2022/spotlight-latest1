import Layout from '@/components/layout/Layout';
import RestaurantDiscoveryClient from '@/src/components/restaurant/RestaurantDiscoveryClient';

export const dynamic = 'force-dynamic';

export default function RestaurantDiscoveryPage() {
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="Restaurants & Delivery"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix">
        <div className="container">
          <RestaurantDiscoveryClient />
        </div>
      </section>
    </Layout>
  );
}
