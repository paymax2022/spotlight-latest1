// ── Association — Shared admin content listing ────────────────────────────────
//
// The six org-scoped admin listings return the same `AdminContentRow` shape, so
// they render through one list instead of six near-identical screens.

import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronRight, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useAdminAccess } from '../hooks/useAdminMembers';
import { useAdminContent, type ContentKind } from '../hooks/useAuthoring';
import { formatDateTime } from '../utils/associationFormatters';
import { hasAuthoringCapability, type AuthoringCapability } from '../utils/authoringAccess';
import type { AdminContentRow } from '../types/authoring.types';

interface Props {
  kind:      ContentKind;
  title:     string;
  /** Which capability gates authoring here. */
  capability: AuthoringCapability;
  newLabel:  string;
  emptyTitle: string;
  emptyMessage: string;
  emptyIcon?: string;
  onNew:     (orgId: string) => void;
  onOpen?:   (row: AdminContentRow) => void;
  /** Extra line under the title, e.g. "Paid · ₦5,000". */
  describe?: (row: AdminContentRow) => string | null;
}

export default function AdminContentList({
  kind, title, capability, newLabel, emptyTitle, emptyMessage, emptyIcon,
  onNew, onOpen, describe,
}: Props) {
  const access = useAdminAccess();
  const orgId = access.data?.organisationId ?? null;
  const rows = useAdminContent(kind, orgId);

  const canManage = hasAuthoringCapability(access.data, capability);

  if (access.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={title} />
        <StateView kind="loading" message="Checking your access…" />
      </SafeAreaView>
    );
  }

  // RBAC gate — mirrors the console dashboard rather than letting the screen
  // render and fail at the first write with a 403.
  if (!canManage) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={title} />
        <StateView
          kind="empty"
          icon="Lock"
          title="Not available for your role"
          message={`Your role (${access.data?.roleLabel ?? 'member'}) cannot manage ${title.toLowerCase()} for this organisation.`}
        />
      </SafeAreaView>
    );
  }

  // An admin with no organisation on their access DTO has nothing to scope the
  // calls with; say so instead of firing requests at `/organisations/undefined`.
  if (!orgId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={title} subtitle={access.data?.organisationName ?? undefined} />
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

      {rows.isLoading ? (
        <StateView kind="loading" message={`Loading ${title.toLowerCase()}…`} />
      ) : rows.isError ? (
        <StateView
          kind="error"
          title="Couldn't load"
          message={(rows.error as Error)?.message ?? 'Please try again.'}
          actionLabel="Retry"
          onAction={() => rows.refetch()}
        />
      ) : (rows.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon={emptyIcon} title={emptyTitle} message={emptyMessage} />
      ) : (
        <FlatList
          data={rows.data ?? []}
          keyExtractor={(r) => r.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          refreshing={rows.isRefetching}
          onRefresh={() => rows.refetch()}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.row, shadow1]}
              onPress={() => onOpen?.(item)}
              disabled={!onOpen}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.title}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                {item.subtitle ? <Text style={styles.rowSub} numberOfLines={1}>{item.subtitle}</Text> : null}
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {formatDateTime(item.at, 'No date set')}
                  {describe?.(item) ? ` · ${describe(item)}` : ''}
                </Text>
              </View>
              {item.status ? (
                <View style={styles.statusChip}><Text style={styles.statusText}>{item.status}</Text></View>
              ) : null}
              {onOpen ? <ChevronRight size={18} color={Colors.outline} strokeWidth={2} /> : null}
            </Pressable>
          )}
        />
      )}

      <View style={styles.footer}>
        <PrimaryButton label={newLabel} onPress={() => onNew(orgId)} />
      </View>
    </SafeAreaView>
  );
}

/** Small "+ New" affordance for screens that want it in the header slot. */
export function NewContentButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={styles.headerBtn}>
      <Plus size={20} color={Colors.primary} strokeWidth={2.4} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 140 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md,
  },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  rowMeta: { ...Typography.caption, color: Colors.outline, marginTop: 2 },
  statusChip: {
    backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
  },
  statusText: { ...Typography.caption, color: Colors.onSurfaceVariant, fontWeight: '700' as const },
  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg,
    backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
  },
  headerBtn: {
    width: 40, height: 40, borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple,
  },
});
