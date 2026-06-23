import Layout from "@/components/layout/Layout"

export default function PrivacyPolicyPage() {
  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <section className="max-w-5xl mx-auto px-4 md:px-8 py-16">
        <h1 className="font-display text-4xl text-foreground">Privacy Policy</h1>
        <p className="text-foreground/70 mt-4">Spotlight protects participant, sponsor, and partner information. Full legal privacy policy text should be inserted by legal/compliance before production launch.</p>
      </section>
    </Layout>
  );
}
