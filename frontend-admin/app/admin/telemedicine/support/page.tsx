'use client';

import { PageHeader, TelemedTabs, DisclosureNote } from '../_ui';
import { QueueBoard } from './_queue';

export default function TelemedSupportPage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Clinician support"
        subtitle="Support tickets, disputes and call disputes raised from the doctor app. Replies and status changes reach the clinician in their app."
      />
      <TelemedTabs active="support" />
      <DisclosureNote>
        Live queues from <code>/api/v1/telemedicine/admin/support/*</code>. Viewing needs <code>telemedicine.admin.view</code>;
        replying, assigning and changing status need <code>telemedicine.admin.manage</code>. Every action is written to the
        clinician&apos;s compliance audit trail.
      </DisclosureNote>
      <QueueBoard kinds={['ticket', 'dispute', 'call_dispute']} />
    </div>
  );
}
