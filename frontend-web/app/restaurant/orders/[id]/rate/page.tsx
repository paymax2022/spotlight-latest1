import Layout from '@/components/layout/Layout';
import RestaurantRateOrderClient from '@/src/components/restaurant/RestaurantRateOrderClient';

export const dynamic = 'force-dynamic';

export default async function RestaurantRateOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="Rate Your Order"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix">
        <div className="container">
          <RestaurantRateOrderClient orderId={id} />
        </div>
      </section>
    </Layout>
  );
}
