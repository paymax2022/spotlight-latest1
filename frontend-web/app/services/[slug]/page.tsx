import { notFound } from 'next/navigation';
import Layout from "@/components/layout/Layout"
import ServicePageTemplate from '@/src/components/spotlight/ServicePageTemplate';
import { services, serviceBySlug } from '@/src/data/services';

export async function generateStaticParams() {
  return services.map((service) => ({ slug: service.slug }));
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const service = serviceBySlug[params.slug];
  if (!service) {
    return {};
  }

  return {
    title: `${service.title} | Spotlight Talent Hunt & Creative Empowerment Platform`,
    description: service.summary,
    openGraph: {
      title: `${service.title} | Spotlight`,
      description: service.summary,
    },
    keywords: ['Spotlight', service.title, service.category, 'youth empowerment', 'creative economy'],
  };
}

export default function ServiceDetailPage({ params }: { params: { slug: string } }) {
  const service = serviceBySlug[params.slug];
  if (!service) notFound();

  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <ServicePageTemplate service={service} />
    </Layout>
  );
}
