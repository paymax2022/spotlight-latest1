import React from 'react';
import { Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, AuditEntryRow, EdgeStateView } from '@/features/doctor/components';
import { useAuditTrail } from '@/features/doctor/hooks';
import { AUDIT_SCOPE_LABELS } from '@/features/doctor/constants';
import type { AuditScope } from '@/types/doctor.batch7';

// ── Section AB — Scoped audit trail (AB.7-10, one AuditTrail by AuditScope) ─────
// NEW screen: the four audit screens (prescription / consultation / lab / HMO)
// collapse to one screen keyed by the `scope` param. Reuses AuditEntryRow; empty
// state renders via the shared EdgeStateView (no_prescriptions-style empty).

const VALID: AuditScope[] = ['prescription', 'consultation', 'lab', 'hmo'];

export default function AuditTrailScreen() {
  const params = useLocalSearchParams<{ scope?: string }>();
  const scope = (params.scope && VALID.includes(params.scope as AuditScope) ? params.scope : 'prescription') as AuditScope;
  const { data: trail, isLoading, isError, refetch } = useAuditTrail(scope);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title={AUDIT_SCOPE_LABELS[scope]} />
      {isLoading && !trail ? (
        <StateView variant="loading" label="Loading audit trail" />
      ) : isError || !trail ? (
        <StateView variant="error" message="We could not load this audit trail." onRetry={() => refetch()} />
      ) : trail.entries.length === 0 ? (
        <EdgeStateView kind="no_prescriptions" />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <Text style={styles.updated}>Updated {new Date(trail.updatedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
          <SectionCard style={styles.card}>
            {trail.entries.map((e, i) => <AuditEntryRow key={e.id} entry={e} border={i > 0} />)}
          </SectionCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  updated: { ...Typography.caption, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  card:    { marginBottom: Spacing.md },
});
