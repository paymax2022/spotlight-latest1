import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Paperclip } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { usePartnerClaims, usePartnerClaim } from '@/features/insurance/partner';
import { UnderwriterBadge, PremiumRow } from '@/features/insurance/components';
import ClaimStateChip from '@/features/insurance/components/claims-ClaimStateChip';
import ClaimTimeline from '@/features/insurance/components/claims-ClaimTimeline';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import type { Claim } from '@/features/insurance/claims';

/** Partner/driver: claim status (PRD §15.3). With id → detail; without → list. */
export default function PartnerClaimStatus() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  if (id) return <ClaimDetail id={id} />;
  return <ClaimList />;
}

function ClaimList() {
  const claims = usePartnerClaims();
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My claims" subtitle="Track your claims" />
      {claims.isLoading ? (
        <StateView kind="loading" message="Loading claims…" />
      ) : claims.isError ? (
        <StateView kind="error" title="Couldn't load claims" actionLabel="Retry" onAction={() => claims.refetch()} />
      ) : (claims.data ?? []).length === 0 ? (
        <StateView kind="empty" title="No claims yet" message="File a claim if you have an incident on the job." icon="FileText" actionLabel="File a claim" onAction={() => router.push('/insurance/partner/file-claim')} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          {(claims.data ?? []).map((c) => (
            <Pressable key={c.id} onPress={() => router.push(`/insurance/partner/claim-status?id=${c.id}`)} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{c.policyName}</Text>
                <Text style={styles.sub} numberOfLines={1}>{c.perilLabel}</Text>
              </View>
              <ClaimStateChip state={c.state} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ClaimDetail({ id }: { id: string }) {
  const claim = usePartnerClaim(id);
  if (claim.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Claim status" />
        <StateView kind="loading" message="Loading claim…" />
      </SafeAreaView>
    );
  }
  if (claim.isError || !claim.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Claim status" />
        <StateView kind="error" title="Couldn't load claim" actionLabel="Retry" onAction={() => claim.refetch()} />
      </SafeAreaView>
    );
  }
  const c: Claim = claim.data;
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Claim status" subtitle={c.policyName} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <ClaimStateChip state={c.state} />
          <Text style={styles.peril}>{c.perilLabel}</Text>
        </View>
        <UnderwriterBadge disclosure={c.disclosure} />
        <View style={styles.detailCard}>
          <PremiumRow label="Amount claimed" amountKobo={c.claimedAmountKobo} />
          {c.approvedAmountKobo != null ? <PremiumRow label="Amount approved" amountKobo={c.approvedAmountKobo} /> : null}
          <PremiumRow label="Reported" value={new Date(c.reportedAt).toLocaleDateString('en-NG', { dateStyle: 'medium' } as any)} />
        </View>
        <Pressable style={styles.evBtn} onPress={() => router.push(`/insurance/partner/inspection-upload?id=${c.id}`)} accessibilityRole="button">
          <Paperclip size={16} color={InsuranceColors.brand} />
          <Text style={styles.evBtnText}>Inspection photos ({c.evidence.length})</Text>
        </Pressable>
        <Text style={styles.section}>Progress</Text>
        <ClaimTimeline entries={c.timeline} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 48, gap: Spacing.md },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 24, gap: Spacing.md },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, padding: Spacing.md },
  pressed: { opacity: 0.9 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  header: { gap: Spacing.xs },
  peril: { ...Typography.titleMd, color: Colors.onSurface },
  detailCard: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  evBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, alignSelf: 'flex-start', backgroundColor: InsuranceColors.surfaceAlt, borderRadius: Radius.full, paddingVertical: 8, paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: InsuranceColors.border },
  evBtnText: { ...Typography.labelLg, color: InsuranceColors.text },
  section: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
});
