// ── Association — Resolve one listing row for an edit screen ──────────────────
//
// There is no per-item admin GET: the org-scoped listings already carry every
// field the edit forms need inside `meta`, so the row is looked up in that
// listing rather than inventing an endpoint the server does not serve.

import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useAdminAccess } from '../hooks/useAdminMembers';
import { useAdminContentRow, type ContentKind } from '../hooks/useAuthoring';
import type { AdminContentRow } from '../types/authoring.types';

interface Props {
  kind:   ContentKind;
  id?:    string;
  title:  string;
  /** Rendered once the row is resolved. */
  render: (row: AdminContentRow) => React.ReactNode;
  /** Where "Back to list" goes when the row cannot be found. */
  listRoute: string;
}

export default function AdminContentEditor({ kind, id, title, render, listRoute }: Props) {
  const access = useAdminAccess();
  const orgId = access.data?.organisationId ?? null;
  const { row, isLoading, isError, error, refetch } = useAdminContentRow(kind, orgId, id);

  if (access.isLoading || isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={title} />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={title} />
        <StateView
          kind="error"
          title="Couldn't load"
          message={(error as Error)?.message ?? 'Please try again.'}
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      </SafeAreaView>
    );
  }

  if (!row) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={title} />
        <StateView
          kind="empty"
          icon="SearchX"
          title="Not found"
          message="This item is no longer in the list — it may have been deleted."
          actionLabel="Back to list"
          onAction={() => router.replace(listRoute)}
        />
      </SafeAreaView>
    );
  }

  return <>{render(row)}</>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
});
