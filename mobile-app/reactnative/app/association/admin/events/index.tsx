import React from 'react';
import { router } from 'expo-router';
import AdminContentList from '@/features/association/components/AdminContentList';
import { CONTENT_CAPABILITY } from '@/features/association/utils/authoringAccess';
import { bool, kobo, num } from '@/features/association/utils/metaFields';
import { formatNaira } from '@/features/association/utils/associationFormatters';

export default function AdminEventsList() {
  return (
    <AdminContentList
      kind="events"
      title="Events"
      capability={CONTENT_CAPABILITY}
      newLabel="New event"
      emptyIcon="CalendarDays"
      emptyTitle="No events yet"
      emptyMessage="Create one to open registration for members."
      onNew={() => router.push('/association/admin/events/new')}
      onOpen={(row) => router.push(`/association/admin/events/${row.id}`)}
      describe={(row) => {
        const parts: string[] = [];
        // feeKobo is integer minor units; formatNaira does the only division.
        parts.push(bool(row.meta.paid) ? `Paid · ${formatNaira(kobo(row.meta.feeKobo))}` : 'Free');
        const registered = num(row.meta.registeredCount);
        if (registered !== null) parts.push(`${registered} registered`);
        const awaiting = num(row.meta.awaitingPayment);
        if (awaiting) parts.push(`${awaiting} awaiting payment`);
        return parts.join(' · ');
      }}
    />
  );
}
