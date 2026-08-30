import React from 'react';
import { router } from 'expo-router';
import AdminContentList from '@/features/association/components/AdminContentList';
import { DUES_CAPABILITY } from '@/features/association/utils/authoringAccess';
import { kobo, num } from '@/features/association/utils/metaFields';
import { formatNaira } from '@/features/association/utils/associationFormatters';

/**
 * Dues runs already raised for this organisation — the "what has already been
 * billed" view an admin should read before raising more.
 */
export default function AdminDuesRunsList() {
  return (
    <AdminContentList
      kind="duesRuns"
      title="Dues runs"
      capability={DUES_CAPABILITY}
      newLabel="Raise dues"
      emptyIcon="Receipt"
      emptyTitle="No dues have been raised"
      emptyMessage="A dues run raises one invoice per active member, priced from their own membership category."
      onNew={() => router.push('/association/admin/dues/run')}
      describe={(row) => {
        const invoiced = num(row.meta.invoiced) ?? 0;
        const parts = [`${invoiced} invoiced`, formatNaira(kobo(row.meta.totalKobo))];
        const paid = num(row.meta.paidCount);
        if (paid !== null) parts.push(`${paid} paid`);
        const outstanding = kobo(row.meta.outstandingKobo);
        if (outstanding > 0) parts.push(`${formatNaira(outstanding)} outstanding`);
        return parts.join(' · ');
      }}
    />
  );
}
