import Layout from '@/components/layout/Layout';
import UtilityReceiptClient from '@/src/components/utility/UtilityReceiptClient';

export const metadata = {
  title: 'Receipt | Spotlight',
  description: 'Utility bill payment receipt.',
};

export default async function UtilityReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={false}
      breadcrumbTitle="Receipt"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix bg-cover" style={{ backgroundImage: 'url("/assets/img/service/service-bg-2.jpg")' }}>
        <div className="container">
          <UtilityReceiptClient transactionId={id} />
        </div>
      </section>
    </Layout>
  );
}
