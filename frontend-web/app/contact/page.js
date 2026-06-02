import Layout from "@/components/layout/Layout";
import ContactPageForm from "@/src/components/spotlight/ContactPageForm";

export const metadata = {
  title: 'Contact Spotlight | Partnerships, Media & Talent Inquiries',
  description: 'Contact Spotlight for sponsorship, institutional partnerships, media requests, talent support, and Season 2 enquiries.',
  alternates: { canonical: '/contact' },
  openGraph: {
    title: 'Contact Spotlight | Partnerships, Media & Talent Inquiries',
    description: 'Contact Spotlight for sponsorship, institutional partnerships, media requests, talent support, and Season 2 enquiries.',
    url: '/contact',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Contact Spotlight | Partnerships, Media & Talent Inquiries',
    description: 'Contact Spotlight for sponsorship, institutional partnerships, media requests, talent support, and Season 2 enquiries.',
  },
};

export default function Contact() {
  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-16">
        <h1 className="font-display text-4xl md:text-6xl text-foreground">Contact Spotlight</h1>
        <p className="text-foreground/70 mt-4 max-w-3xl">Reach the Spotlight team for sponsorship, media, government partnerships, and talent-related support.</p>
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="glass-card rounded-md p-6">
            <h2 className="font-display text-2xl text-foreground">Contact Channels</h2>
            <div className="mt-4 space-y-3 text-sm text-foreground/75">
              <p><strong>Email:</strong> <a href="mailto:info@spotlightng.com">info@spotlightng.com</a></p>
              <p><strong>Phone / WhatsApp:</strong> <a href="tel:+2348063437144">+234 806 343 7144</a></p>
              <p><strong>Press:</strong> <a href="mailto:info@spotlightng.com">info@spotlightng.com</a></p>
              <p><strong>Partnerships:</strong> <a href="mailto:info@spotlightng.com">info@spotlightng.com</a></p>
            </div>
          </div>
          <ContactPageForm />
        </div>
      </section>
    </Layout>
  );
}
