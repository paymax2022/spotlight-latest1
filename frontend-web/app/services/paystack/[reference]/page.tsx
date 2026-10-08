import Layout from '@/components/layout/Layout';
import UtilityPaystackStatusClient from '@/src/components/utility/UtilityPaystackStatusClient';

export const metadata = {
  title: 'Confirming Payment | Spotlight',
  description: 'Confirming your utility bill card payment.',
};

export default async function UtilityPaystackStatusPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={false}
      breadcrumbTitle="Confirming Payment"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix bg-cover" style={{ backgroundImage: 'url("/assets/img/service/service-bg-2.jpg")' }}>
        <div className="container">
          <UtilityPaystackStatusClient reference={reference} />
        </div>
      </section>
    </Layout>
  );
}
