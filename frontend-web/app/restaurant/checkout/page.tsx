import Layout from '@/components/layout/Layout';
import RestaurantCheckoutClient from '@/src/components/restaurant/RestaurantCheckoutClient';

export const dynamic = 'force-dynamic';

export default function RestaurantCheckoutPage() {
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="Checkout"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix">
        <div className="container">
          <RestaurantCheckoutClient />
        </div>
      </section>
    </Layout>
  );
}
