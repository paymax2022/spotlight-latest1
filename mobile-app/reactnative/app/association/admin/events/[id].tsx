import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import AdminContentEditor from '@/features/association/components/AdminContentEditor';
import EventForm from '@/features/association/components/forms/EventForm';

export default function EditEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AdminContentEditor
      kind="events"
      id={id}
      title="Edit event"
      listRoute="/association/admin/events"
      render={(row) => <EventForm row={row} />}
    />
  );
}
