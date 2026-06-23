import StemAdminConsole from '@/components/stem/StemAdminConsole';

export const metadata = {
  title: 'Admin STEM Console | Spotlight',
  description:
    'Admin-controlled STEM contest builder for contests, categories, pricing, prizes, schools, and application review.',
};

export default function AdminStemPage() {
  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <div className="mb-3">
        <h1 className="mb-1 font-display text-3xl md:text-4xl text-foreground">STEM Management Console</h1>
        <p className="text-foreground-muted mb-0">School and emerging innovator administration, review workflows, and impact reporting.</p>
      </div>
      <StemAdminConsole />
    </section>
  );
}
