import Layout from '@/components/layout/Layout';
import ProfileEditorClient from '@/components/user/ProfileEditorClient';

export const dynamic = 'force-dynamic';

export default function ProfilePage() {
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle="My Profile"
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix bg-cover" style={{ backgroundImage: 'url("/assets/img/service/service-bg-2.jpg")' }}>
        <div className="container">
          <ProfileEditorClient />
        </div>
      </section>
    </Layout>
  );
}
