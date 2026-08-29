import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import AdminContentEditor from '@/features/association/components/AdminContentEditor';
import DocumentForm from '@/features/association/components/forms/DocumentForm';

export default function EditDocument() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AdminContentEditor
      kind="documents"
      id={id}
      title="Edit document"
      listRoute="/association/admin/documents"
      render={(row) => <DocumentForm row={row} />}
    />
  );
}
