import Layout from '@/components/layout/Layout';
import type { ReactNode } from 'react';

export default function OpenMicSlugLayout({ children }: { children: ReactNode }) {
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={null}
      breadcrumbTitle={null}
      breadcrumbClassName=""
      breadcrumbPadding={undefined}
    >
      {children}
    </Layout>
  );
}
