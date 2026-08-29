import React from 'react';
import { router } from 'expo-router';
import AdminContentList from '@/features/association/components/AdminContentList';
import { CONTENT_CAPABILITY } from '@/features/association/utils/authoringAccess';
import { str, strList } from '@/features/association/utils/metaFields';

export default function AdminTasksList() {
  return (
    <AdminContentList
      kind="tasks"
      title="Tasks"
      capability={CONTENT_CAPABILITY}
      newLabel="New task"
      emptyIcon="ListChecks"
      emptyTitle="No tasks yet"
      emptyMessage="Assign work to a member or a committee and track it here."
      onNew={() => router.push('/association/admin/tasks/new')}
      onOpen={(row) => router.push(`/association/admin/tasks/${row.id}`)}
      describe={(row) => {
        const parts: string[] = [];
        const priority = str(row.meta.priority);
        if (priority) parts.push(priority);
        const steps = strList(row.meta.checklist).length;
        if (steps) parts.push(`${steps} step${steps === 1 ? '' : 's'}`);
        if (!str(row.meta.assigneeName)) parts.push('Unassigned');
        return parts.length ? parts.join(' · ') : null;
      }}
    />
  );
}
