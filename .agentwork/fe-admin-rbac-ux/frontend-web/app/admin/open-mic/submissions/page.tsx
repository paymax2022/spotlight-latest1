import OpenMicAdminSubmissionReview from '@/components/openmic/OpenMicAdminSubmissionReview';
import OpenMicFinaleManager from '@/components/openmic/OpenMicFinaleManager';

export default function AdminOpenMicSubmissionsPage() {
  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <h1 className="font-display text-3xl md:text-4xl text-foreground">Open Mic Submission Review</h1>
      <p className="text-foreground-muted mt-1">Approve, reject, publish for voting, shortlist finalists, and mark winners.</p>
      <section className="p-4 glass-card rounded-md mt-4">
        <OpenMicAdminSubmissionReview />
      </section>
      <section className="p-4 glass-card rounded-md mt-4">
        <h2 className="mb-3 font-display text-foreground">Finale Playlist and Winner Control</h2>
        <OpenMicFinaleManager />
      </section>
    </section>
  );
}
