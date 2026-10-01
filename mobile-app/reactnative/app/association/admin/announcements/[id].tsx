import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import {AdminContentEditor} from '@/features/association/components';
import { AnnouncementForm } from '@/features/association/components/forms';

export default function EditAnnouncement() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AdminContentEditor
      kind="announcements"
      id={id}
      title="Edit announcement"
      listRoute="/association/admin/announcements"
      render={(row) => <AnnouncementForm row={row} />}
    />
  );
}
