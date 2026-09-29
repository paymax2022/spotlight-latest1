import Layout from '@/components/layout/Layout';
import RestaurantDetailClient from '@/src/components/restaurant/RestaurantDetailClient';

export const dynamic = 'force-dynamic';

export default async function RestaurantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="Restaurant"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix">
        <div className="container">
          <RestaurantDetailClient restaurantId={id} />
        </div>
      </section>
    </Layout>
  );
}
