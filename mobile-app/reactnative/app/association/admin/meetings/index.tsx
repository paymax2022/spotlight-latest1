import React from 'react';
import { router } from 'expo-router';
import AdminContentList from '@/features/association/components/AdminContentList';
import { CONTENT_CAPABILITY } from '@/features/association/utils/authoringAccess';
import { bool, num } from '@/features/association/utils/metaFields';

export default function AdminMeetingsList() {
  return (
    <AdminContentList
      kind="meetings"
      title="Meetings"
      capability={CONTENT_CAPABILITY}
      newLabel="New meeting"
      emptyIcon="CalendarClock"
      emptyTitle="No meetings yet"
      emptyMessage="Schedule one to open RSVPs and attendance check-in."
      onNew={() => router.push('/association/admin/meetings/new')}
      onOpen={(row) => router.push(`/association/admin/meetings/${row.id}`)}
      describe={(row) => {
        const parts: string[] = [];
        const rsvp = num(row.meta.rsvpCount);
        if (rsvp !== null) parts.push(`${rsvp} RSVP`);
        const checked = num(row.meta.checkedInCount);
        if (checked !== null) parts.push(`${checked} checked in`);
        if (bool(row.meta.minutesPublished)) parts.push('Minutes published');
        return parts.length ? parts.join(' · ') : null;
      }}
    />
  );
}
