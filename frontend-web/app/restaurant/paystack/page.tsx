import { Suspense } from 'react';
import Layout from '@/components/layout/Layout';
import RestaurantPaystackStatusClient from '@/src/components/restaurant/RestaurantPaystackStatusClient';

export const dynamic = 'force-dynamic';

export default function RestaurantPaystackStatusPage() {
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="Payment Status"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix">
        <div className="container">
          <Suspense fallback={null}>
            <RestaurantPaystackStatusClient />
          </Suspense>
        </div>
      </section>
    </Layout>
  );
}
