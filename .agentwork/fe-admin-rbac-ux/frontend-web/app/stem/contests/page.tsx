import Layout from '@/components/layout/Layout';
import StemContestList from '@/components/stem/StemContestList';

export const metadata = {
  title: 'STEM Contests | Spotlight',
  description:
    'Explore published Spotlight STEM contests and apply through the correct school/student or independent innovator pathway.',
};

export default function StemContestsPage() {
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={false}
      breadcrumbTitle="STEM Contests"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="service-section fix section-padding">
        <div className="container">
          <div className="section-title text-center">
            <span>SPOTLIGHT STEM</span>
            <h2>Published STEM Contest Opportunities</h2>
          </div>
          <StemContestList />
        </div>
      </section>
    </Layout>
  );
}
