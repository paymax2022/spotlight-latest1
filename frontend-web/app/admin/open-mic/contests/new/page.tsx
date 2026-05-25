import OpenMicAdminContestBuilder from '@/components/openmic/OpenMicAdminContestBuilder';

export default function AdminOpenMicNewContestPage() {
  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <h1 className="font-display text-3xl md:text-4xl text-foreground">Create Monthly Open Mic Contest</h1>
      <p className="text-foreground-muted mt-1">
        Configure month, recurrence, fees, voting weights, and finale venue for a new Open Mic edition.
      </p>
      <section className="p-4 glass-card rounded-md mt-4">
        <OpenMicAdminContestBuilder />
      </section>
    </section>
  );
}
