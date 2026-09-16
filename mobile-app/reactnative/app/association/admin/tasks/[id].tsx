import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import AdminContentEditor from '@/features/association/components/AdminContentEditor';
import TaskForm from '@/features/association/components/forms/TaskForm';

export default function EditTask() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AdminContentEditor
      kind="tasks"
      id={id}
      title="Edit task"
      listRoute="/association/admin/tasks"
      render={(row) => <TaskForm row={row} />}
    />
  );
}
