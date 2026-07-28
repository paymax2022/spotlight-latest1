import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Lock, Pill, AlertTriangle, Activity } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useHealthProfile } from '@/features/health/hooks';
import { NDPA_CONSENT_COPY, formatDate } from '@/features/health/constants/health.constants';
import type { HealthProfileEntry } from '@/features/health/types';

/**
 * M17 — My Health Profile. A persistent, longitudinal record of conditions,
 * medications and allergies aggregated from prior intakes; pre-fills future
 * intakes (PRD §3). Allergies & medications are safety-critical → highlighted.
 */
export default function HealthProfileScreen() {
  const { data: profile, isLoading, isError, refetch } = useHealthProfile();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My health profile" subtitle="From your intakes" />

      <View style={styles.privacy}>
        <Lock size={13} color={Colors.teal} strokeWidth={2} />
        <Text style={styles.privacyText}>{NDPA_CONSENT_COPY}</Text>
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading your profile…" />
      ) : isError || !profile ? (
        <StateView kind="error" title="Couldn’t load profile" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>
            Patient-reported — kept up to date from your consult intakes. This pre-fills your next intake so you never re-enter it.
          </Text>

          <Section
            title="Allergies"
            icon={<AlertTriangle size={16} color={Colors.error} strokeWidth={2} />}
            entries={profile.allergies}
            critical
            emptyLabel="No allergies reported"
          />
          <Section
            title="Current medications"
            icon={<Pill size={16} color={Colors.error} strokeWidth={2} />}
            entries={profile.medications}
            critical
            emptyLabel="No medications reported"
          />
          <Section
            title="Chronic conditions"
            icon={<Activity size={16} color={Colors.primary} strokeWidth={2} />}
            entries={profile.conditions}
            emptyLabel="No conditions reported"
          />

          <Text style={styles.updated}>
            Built from {profile.sourceCount} intake{profile.sourceCount === 1 ? '' : 's'}
            {profile.updatedAt ? ` · updated ${formatDate(profile.updatedAt)}` : ''}
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Section({
  title, icon, entries, critical, emptyLabel,
}: {
  title: string;
  icon: React.ReactNode;
  entries: HealthProfileEntry[];
  critical?: boolean;
  emptyLabel: string;
}) {
  return (
    <View style={[styles.card, critical && styles.cardCritical]}>
      <View style={styles.cardHead}>
        {icon}
        <Text style={styles.cardTitle}>{title}</Text>
        {critical ? <Text style={styles.criticalTag}>Safety-critical</Text> : null}
      </View>
      {entries.length === 0 ? (
        <Text style={styles.empty}>{emptyLabel}</Text>
      ) : (
        entries.map((e, i) => (
          <View key={`${e.label}-${i}`} style={styles.row}>
            <Text style={[styles.rowLabel, critical && styles.rowLabelCritical]}>{e.label}</Text>
            <Text style={styles.rowVal}>{e.value}</Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, paddingHorizontal: Spacing.sm + 2, paddingVertical: 7 },
  privacyText: { ...Typography.caption, color: Colors.tertiaryContainer, flex: 1, lineHeight: 16 },
  content: { padding: Spacing.containerMargin, gap: Spacing.md },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs },
  cardCritical: { borderColor: Colors.errorContainer },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  criticalTag: { ...Typography.caption, color: Colors.error, fontWeight: '700' as const },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: 6, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  rowLabelCritical: { fontWeight: '700' as const },
  rowVal: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant, paddingVertical: Spacing.xs },
  updated: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm },
});
