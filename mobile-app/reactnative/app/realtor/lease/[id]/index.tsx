import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, FileSignature, CalendarRange } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import DetailRow from '@/features/realtor/components/DetailRow';
import StatusBadge from '@/features/realtor/components/StatusBadge';
import { useLease } from '@/features/realtor/hooks/useRealtorLease';
import { formatNaira, formatSlotDate } from '@/features/realtor/utils/realtorFormatters';
import { SCHEDULE_LABEL } from '@/features/realtor/constants/realtor.constants';

export default function LeasePreviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lease = useLease(String(id));

  if (lease.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Lease agreement" />
        <StateView kind="loading" message="Loading your lease…" />
      </SafeAreaView>
    );
  }
  if (lease.isError || !lease.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Lease agreement" />
        <StateView kind="error" title="Lease unavailable" actionLabel="Back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  const l = lease.data;
  const total = l.rent + l.cautionDeposit + (l.serviceCharge ?? 0);
  const signed = l.tenantSigned;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Lease agreement"
        subtitle={l.listingTitle}
        rightSlot={<StatusBadge label={signed ? 'Signed' : 'Action needed'} tone={signed ? 'success' : 'warning'} />}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.headerCard}>
          <CalendarRange size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.headerText}>
            {formatSlotDate(l.startDate)} — {formatSlotDate(l.endDate)} · 12-month tenancy
          </Text>
        </View>

        <SectionHeader title="Terms" style={styles.sectionFlush} />
        <View style={styles.card}>
          <DetailRow label="Rent" value={`${formatNaira(l.rent)} ${SCHEDULE_LABEL[l.rentSchedule]}`} />
          <DetailRow label="Caution deposit" value={formatNaira(l.cautionDeposit)} refundable />
          {l.serviceCharge ? <DetailRow label="Service charge" value={formatNaira(l.serviceCharge)} /> : null}
          <View style={styles.divider} />
          <DetailRow label="Total move-in cost" value={formatNaira(total)} emphasis />
        </View>

        <View style={styles.escrowNote}>
          <ShieldCheck size={14} color={Colors.tertiaryContainer} strokeWidth={2.2} />
          <Text style={styles.escrowText}>
            Your caution deposit is held in escrow and refunded within 14 days of a clean move-out inspection.
          </Text>
        </View>

        <SectionHeader title="Clauses" style={styles.sectionFlush} />
        <View style={styles.card}>
          {l.clauses.map((c) => (
            <View key={c.heading} style={styles.clause}>
              <Text style={styles.clauseHeading}>{c.heading}</Text>
              <Text style={styles.clauseBody}>{c.body}</Text>
            </View>
          ))}
        </View>

        <View style={styles.signatures}>
          <SignatureRow label="Landlord" signed={l.landlordSigned} />
          <SignatureRow label="You (tenant)" signed={l.tenantSigned} />
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {signed ? (
          <PrimaryButton
            label={l.invoiceId ? 'Continue to payment' : 'Lease signed'}
            onPress={() => l.invoiceId && router.push(`/realtor/lease/${l.id}/pay`)}
          />
        ) : (
          <PrimaryButton label="Review & sign" onPress={() => router.push(`/realtor/lease/${l.id}/sign`)} />
        )}
      </SafeAreaView>
    </SafeAreaView>
  );
}

function SignatureRow({ label, signed }: { label: string; signed: boolean }) {
  return (
    <View style={styles.sigRow}>
      <FileSignature size={16} color={signed ? Colors.tertiaryContainer : Colors.outline} strokeWidth={2} />
      <Text style={styles.sigLabel}>{label}</Text>
      <StatusBadge label={signed ? 'Signed' : 'Pending'} tone={signed ? 'success' : 'neutral'} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl },
  headerCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.sm,
  },
  headerText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  sectionFlush: { paddingHorizontal: 0, marginTop: Spacing.md },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md,
  },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  escrowNote: {
    flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.md,
  },
  escrowText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  clause: { paddingVertical: Spacing.sm },
  clauseHeading: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: 2 },
  clauseBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  signatures: { marginTop: Spacing.lg, gap: Spacing.sm },
  sigRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md,
  },
  sigLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest,
  },
});
