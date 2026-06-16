import Link from 'next/link';
import type { ServiceItem } from '@/src/data/services';
import { serviceBySlug } from '@/src/data/services';
import ServiceInquiryForm from './ServiceInquiryForm';

export default function ServicePageTemplate({ service }: { service: ServiceItem }) {
  const related = service.relatedServices
    .map((slug) => serviceBySlug[slug])
    .filter(Boolean)
    .slice(0, 3) as ServiceItem[];
  const hasServiceBanner = Boolean(service.bannerImage);

  return (
    <div>
      <section className={`relative overflow-hidden px-4 md:px-8 ${hasServiceBanner ? 'min-h-[320px] md:min-h-[520px]' : 'py-20 md:py-28'}`}>
        {hasServiceBanner ? (
          <img src={service.bannerImage} alt={`${service.title} banner`} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(212,168,67,0.18),transparent_45%)]" />
            <div className="max-w-6xl mx-auto relative">
              <p className="section-label">{service.category}</p>
              <h1 className="font-display text-4xl md:text-6xl text-foreground mt-4 max-w-4xl">{service.heroTitle}</h1>
              <p className="text-foreground/70 text-lg mt-5 max-w-3xl leading-relaxed">{service.heroSubtitle}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/contact" className="btn-primary text-xs py-3 px-6">{service.ctaPrimary}</Link>
                <Link href="/services" className="btn-outline text-xs py-3 px-6">Explore All Services</Link>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="max-w-6xl mx-auto px-4 md:px-8 py-10 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-card rounded-md p-6">
          <h2 className="font-display text-2xl text-foreground">Who This Is For</h2>
          <ul className="mt-4 space-y-2 text-foreground/70 text-sm">
            {service.audience.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </div>
        <div className="glass-card rounded-md p-6">
          <h2 className="font-display text-2xl text-foreground">What Spotlight Delivers</h2>
          <ul className="mt-4 space-y-2 text-foreground/70 text-sm">
            {service.deliverables.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 md:px-8 py-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card rounded-md p-6">
          <h3 className="font-display text-xl text-foreground">How It Works</h3>
          <ol className="mt-4 space-y-2 text-sm text-foreground/70">
            {service.process.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ol>
        </div>
        <div className="glass-card rounded-md p-6">
          <h3 className="font-display text-xl text-foreground">Benefits</h3>
          <ul className="mt-4 space-y-2 text-sm text-foreground/70">
            {service.benefits.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </div>
        <div className="glass-card rounded-md p-6">
          <h3 className="font-display text-xl text-foreground">Expected Outcomes</h3>
          <ul className="mt-4 space-y-2 text-sm text-foreground/70">
            {service.outcomes.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 md:px-8 py-8">
        <ServiceInquiryForm formType={service.formType} serviceName={service.title} />
      </section>

      <section className="max-w-6xl mx-auto px-4 md:px-8 py-6">
        <div className="glass-card rounded-md p-6">
          <h3 className="font-display text-2xl text-foreground">Frequently Asked Questions</h3>
          <div className="mt-4 space-y-3">
            {service.faq.map((item) => (
              <div key={item.q} className="border-b border-border pb-3">
                <p className="text-foreground font-semibold text-sm">{item.q}</p>
                <p className="text-foreground/70 text-sm mt-1">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 md:px-8 py-8 pb-16">
        <h3 className="font-display text-2xl text-foreground">Related Services</h3>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {related.map((item) => (
            <Link key={item.slug} href={`/services/${item.slug}`} className="glass-card rounded-md p-5 hover:border-gold transition-colors">
              <p className="text-foreground font-semibold">{item.title}</p>
              <p className="text-sm text-foreground/60 mt-2">{item.summary}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
