import Link from 'next/link';
import Layout from "@/components/layout/Layout"
import { services } from '@/src/data/services';

export const metadata = {
  title: 'Services | Spotlight Talent Hunt & Creative Empowerment Platform',
  description: 'Explore Spotlight services across talent discovery, reality TV, film, music, STEM innovation, entrepreneurship, sponsorship activation, and youth empowerment programs.',
};

export default function ServicesPage() {
  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-16">
        <p className="section-label">Service Architecture</p>
        <h1 className="font-display text-4xl md:text-6xl text-foreground mt-4">Spotlight Service Portfolio</h1>
        <p className="text-foreground/70 mt-4 max-w-3xl">
          A comprehensive menu of talent discovery, creative economy activation, media production, sponsorship, institutional, and youth empowerment services.
        </p>
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((service) => (
            <Link key={service.slug} href={`/services/${service.slug}`} className="glass-card rounded-md p-5 hover:border-gold transition-colors">
              <p className="text-xs text-foreground/50 uppercase tracking-wider">{service.category}</p>
              <h2 className="text-foreground font-semibold mt-1">{service.title}</h2>
              <p className="text-sm text-foreground/65 mt-2">{service.summary}</p>
            </Link>
          ))}
        </div>
      </section>
    </Layout>
  );
}
