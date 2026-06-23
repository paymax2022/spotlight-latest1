import React from 'react';
import CodeEntryView from '@/features/association/components/CodeEntryView';

export default function InviteCodeEntry() {
  return (
    <CodeEntryView
      kind="INVITE"
      title="Invite code"
      heading="Enter your invite code"
      helper="Paste the invitation code shared by your organisation’s admin. Try “NMA2026”."
      placeholder="INVITE CODE"
    />
  );
}
