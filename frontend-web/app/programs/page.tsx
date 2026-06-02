import Link from 'next/link';
import Layout from "@/components/layout/Layout"
import { featuredPrograms } from '@/src/data/programs';

export const metadata = {
  title: 'Programs | Spotlight',
  description: 'Explore Spotlight flagship programs across talent, media, STEM, and entrepreneurship.',
};

export default function ProgramsPage() {
  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <section className="max-w-6xl mx-auto px-4 md:px-8 py-16">
        <h1 className="font-display text-4xl md:text-6xl text-foreground">Spotlight Programs</h1>
        <p className="text-foreground/70 mt-4 max-w-3xl">
          Spotlight programs are designed to move participants from discovery to development, exposure, and opportunity.
        </p>
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          {featuredPrograms.map((program) => (
            <Link key={program.title} href={program.href} className="glass-card rounded-md p-5">
              <h2 className="text-foreground font-semibold">{program.title}</h2>
              <p className="text-sm text-foreground/65 mt-2">{program.overview}</p>
            </Link>
          ))}
        </div>
      </section>
    </Layout>
  );
}
