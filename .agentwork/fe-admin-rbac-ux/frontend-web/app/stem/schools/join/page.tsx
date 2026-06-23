import Layout from '@/components/layout/Layout';
import StemSchoolJoinRequestForm from '@/components/stem/StemSchoolJoinRequestForm';

export const metadata = {
  title: 'Student School Join Request | Spotlight STEM',
  description:
    'Students can request to join verified schools before applying to school-track STEM contests.',
};

export default function StemSchoolJoinPage() {
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={false}
      breadcrumbTitle="Join a School"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="service-details-section fix section-padding">
        <div className="container">
          <div className="service-details-wrapper">
            <div className="section-title">
              <span>STUDENT ENROLMENT</span>
              <h2>Request to Join a Verified School</h2>
            </div>
            <p className="mt-3">
              Submit your school join request so the school admin can approve your STEM contest participation.
            </p>
            <div className="mt-4">
              <StemSchoolJoinRequestForm />
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
