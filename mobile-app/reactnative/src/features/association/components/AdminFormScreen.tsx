// ── Association — Scaffold for the admin authoring forms ──────────────────────
//
// Every authoring form needs the same three things before it can render a
// single field: the caller's admin access, the capability gate for this content
// type, and the organisation id to scope the write with. Doing that once here
// keeps a missing gate from being a per-screen oversight.

import React from 'react';
import { View, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useAdminAccess } from '../hooks/useAdminMembers';
import { hasAuthoringCapability, type AuthoringCapability } from '../utils/authoringAccess';

interface Props {
  title:      string;
  capability: AuthoringCapability;
  /** Rendered once the org id is known. */
  children:   (orgId: string) => React.ReactNode;
  saveLabel:  string;
  onSave:     (orgId: string) => void;
  saving?:    boolean;
  saveDisabled?: boolean;
  /** Optional destructive action rendered under the primary button. */
  onDelete?:  () => void;
  deleteLabel?: string;
  deleting?:  boolean;
}

export default function AdminFormScreen({
  title, capability, children, saveLabel, onSave, saving, saveDisabled,
  onDelete, deleteLabel = 'Delete', deleting,
}: Props) {
  const access = useAdminAccess();
  const orgId = access.data?.organisationId ?? null;
  const allowed = hasAuthoringCapability(access.data, capability);

  if (access.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={title} />
        <StateView kind="loading" message="Checking your access…" />
      </SafeAreaView>
    );
  }

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={title} />
        <StateView
          kind="empty"
          icon="Lock"
          title="Not available for your role"
          message={`Your role (${access.data?.roleLabel ?? 'member'}) cannot do this for this organisation.`}
        />
      </SafeAreaView>
    );
  }

  if (!orgId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={title} />
        <StateView
          kind="empty"
          icon="Building2"
          title="No organisation linked"
          message="Your admin role isn't attached to an organisation yet, so there is nothing to author against."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={title} subtitle={access.data?.organisationName ?? undefined} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {children(orgId)}
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton
            label={saveLabel}
            onPress={() => onSave(orgId)}
            loading={saving}
            disabled={saveDisabled}
          />
          {onDelete ? (
            <PrimaryButton label={deleteLabel} variant="danger" onPress={onDelete} loading={deleting} />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 40, gap: Spacing.md },
  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg,
    backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
    gap: Spacing.sm,
  },
});
