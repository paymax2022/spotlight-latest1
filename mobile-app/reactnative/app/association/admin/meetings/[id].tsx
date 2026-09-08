import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import AdminContentEditor from '@/features/association/components/AdminContentEditor';
import MeetingForm from '@/features/association/components/forms/MeetingForm';

export default function EditMeeting() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AdminContentEditor
      kind="meetings"
      id={id}
      title="Edit meeting"
      listRoute="/association/admin/meetings"
      render={(row) => <MeetingForm row={row} />}
    />
  );
}
