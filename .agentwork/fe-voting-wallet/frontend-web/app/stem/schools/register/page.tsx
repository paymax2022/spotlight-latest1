import Layout from '@/components/layout/Layout';
import StemSchoolRegistrationForm from '@/components/stem/StemSchoolRegistrationForm';

export const metadata = {
  title: 'School Registration | Spotlight STEM',
  description:
    'Register your school for Spotlight STEM contests. Verified schools can onboard students into eligible challenge tracks.',
};

export default function StemSchoolRegisterPage() {
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={false}
      breadcrumbTitle="School Registration"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="service-details-section fix section-padding">
        <div className="container">
          <div className="service-details-wrapper">
            <div className="section-title">
              <span>SPOTLIGHT STEM SCHOOL TRACK</span>
              <h2>Register Your School</h2>
            </div>
            <p className="mt-3">
              Schools must register and be verified before students apply to school-restricted STEM contests.
            </p>
            <div className="mt-4">
              <StemSchoolRegistrationForm />
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
