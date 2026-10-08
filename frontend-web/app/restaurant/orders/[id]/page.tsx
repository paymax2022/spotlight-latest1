import Layout from '@/components/layout/Layout';
import RestaurantOrderTrackingClient from '@/src/components/restaurant/RestaurantOrderTrackingClient';

export const dynamic = 'force-dynamic';

export default async function RestaurantOrderTrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="Track Order"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix">
        <div className="container">
          <RestaurantOrderTrackingClient orderId={id} />
        </div>
      </section>
    </Layout>
  );
}
