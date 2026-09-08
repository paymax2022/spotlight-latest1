import React from 'react';
import { router } from 'expo-router';
import AdminContentList from '@/features/association/components/AdminContentList';
import { CONTENT_CAPABILITY } from '@/features/association/utils/authoringAccess';
import { bool, num, str } from '@/features/association/utils/metaFields';

export default function AdminDocumentsList() {
  return (
    <AdminContentList
      kind="documents"
      title="Documents"
      capability={CONTENT_CAPABILITY}
      newLabel="Add document"
      emptyIcon="FolderOpen"
      emptyTitle="The vault is empty"
      emptyMessage="Add the constitution, minutes or policies members should be able to read."
      onNew={() => router.push('/association/admin/documents/new')}
      onOpen={(row) => router.push(`/association/admin/documents/${row.id}`)}
      describe={(row) => {
        const parts: string[] = [];
        const version = str(row.meta.version);
        if (version) parts.push(version);
        const size = str(row.meta.sizeLabel);
        if (size) parts.push(size);
        if (bool(row.meta.requiresAck)) parts.push(`${num(row.meta.ackCount) ?? 0} acknowledged`);
        return parts.length ? parts.join(' · ') : null;
      }}
    />
  );
}
