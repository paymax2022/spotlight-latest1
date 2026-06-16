import Layout from '@/components/layout/Layout';
import UtilityPaymentClient from '@/src/components/utility/UtilityPaymentClient';

export const metadata = {
  title: 'Utility Bills | Spotlight',
  description: 'Buy airtime, data, electricity, cable TV, internet and education services with your Spotlight wallet.',
};

export default function UtilityPage() {
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={false}
      breadcrumbTitle="Utility Bills"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix bg-cover" style={{ backgroundImage: 'url("/assets/img/service/service-bg-2.jpg")' }}>
        <div className="container">
          <UtilityPaymentClient />
        </div>
      </section>
    </Layout>
  );
}
