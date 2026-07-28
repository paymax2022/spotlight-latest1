import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Calendar, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { useScholarships, useApplyScholarship } from '@/features/academy/hooks';
import { formatNaira, formatDate, daysUntil } from '@/features/academy/constants';
import type { Scholarship } from '@/features/academy/types';

/** P11 — Scholarships & sponsors: browse and apply. */
export default function ScholarshipsScreen() {
  const scholarships = useScholarships();
  const apply = useApplyScholarship();

  if (scholarships.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading scholarships…" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Scholarships & sponsors" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {scholarships.data?.length ? scholarships.data.map((s) => (
          <ScholarshipCard key={s.id} s={s} busy={apply.isPending} onApply={() => apply.mutate(s.id)} />
        )) : (
          <StateView kind="empty" icon="Award" title="No scholarships" message="Check back soon for new sponsor programmes." compact />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ScholarshipCard({ s, busy, onApply }: { s: Scholarship; busy: boolean; onApply: () => void }) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[s.icon] ?? Icons.Award;
  const days = daysUntil(s.deadline);
  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.top}>
        <View style={styles.icon}><Icon size={20} color={Colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{s.title}</Text>
          <Text style={styles.sponsor}>{s.sponsor}</Text>
        </View>
        <Chip label={s.coverage === 'full' ? 'Full' : 'Partial'} color={s.coverage === 'full' ? Colors.teal : Colors.secondary} bg={s.coverage === 'full' ? Colors.iconBgTeal : Colors.iconBgBlue} small />
      </View>
      <Text style={styles.amount}>{formatNaira(s.amountKobo)}</Text>
      <Text style={styles.eligibility}>{s.eligibility}</Text>
      <View style={styles.deadlineRow}>
        <Calendar size={13} color={days <= 14 ? Colors.error : Colors.onSurfaceVariant} />
        <Text style={[styles.deadlineText, days <= 14 && { color: Colors.error }]}>Closes {formatDate(s.deadline)} ({days}d)</Text>
      </View>
      {s.applied ? (
        <View style={styles.appliedRow}><CheckCircle2 size={16} color={Colors.teal} /><Text style={styles.appliedText}>Application submitted</Text></View>
      ) : (
        <PrimaryButton label="Apply" onPress={onApply} loading={busy} variant="secondary" style={{ marginTop: Spacing.sm }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 4 },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  sponsor: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  amount: { ...Typography.titleLg, color: Colors.primary, marginTop: 4 },
  eligibility: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  deadlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  deadlineText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  appliedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm },
  appliedText: { ...Typography.labelMd, color: Colors.teal, fontWeight: '700' },
});
