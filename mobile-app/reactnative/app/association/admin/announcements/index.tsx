import React from 'react';
import { router } from 'expo-router';
import AdminContentList from '@/features/association/components/AdminContentList';
import { CONTENT_CAPABILITY } from '@/features/association/utils/authoringAccess';
import { bool, num } from '@/features/association/utils/metaFields';

export default function AdminAnnouncementsList() {
  return (
    <AdminContentList
      kind="announcements"
      title="Announcements"
      capability={CONTENT_CAPABILITY}
      newLabel="New announcement"
      emptyIcon="Megaphone"
      emptyTitle="No announcements yet"
      emptyMessage="Post one and it appears in every member's feed."
      onNew={() => router.push('/association/admin/announcements/new')}
      onOpen={(row) => router.push(`/association/admin/announcements/${row.id}`)}
      describe={(row) => {
        const parts: string[] = [];
        if (bool(row.meta.urgent)) parts.push('Urgent');
        const reads = num(row.meta.readCount);
        if (reads !== null) parts.push(`${reads} read`);
        if (bool(row.meta.requiresAck)) {
          const acks = num(row.meta.ackCount) ?? 0;
          parts.push(`${acks} acknowledged`);
        }
        return parts.length ? parts.join(' · ') : null;
      }}
    />
  );
}
