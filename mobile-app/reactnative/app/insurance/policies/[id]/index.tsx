import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ChevronRight, FileBadge, Users, RefreshCw, Ban, History, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { usePolicy } from '@/features/insurance/hooks';
import { UnderwriterBadge, PremiumRow, StateChip, DisclosureSheet } from '@/features/insurance/components';
import { InsuranceColors, PRODUCT_LINE_LABEL } from '@/features/insurance/constants/insurance.constants';

export default function PolicyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const policy = usePolicy(id ?? '');
  const [disclosureOpen, setDisclosureOpen] = useState(false);

  if (policy.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Policy" />
        <StateView kind="loading" message="Loading policy…" />
      </SafeAreaView>
    );
  }
  if (policy.isError || !policy.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Policy" />
        <StateView kind="error" title="Couldn't load policy" actionLabel="Retry" onAction={() => policy.refetch()} />
      </SafeAreaView>
    );
  }

  const p = policy.data;
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[p.icon] ?? ShieldCheck;
  const canRenew = p.state === 'RENEWAL_DUE' || p.state === 'LAPSED';
  const canCancel = p.state === 'ACTIVE' || p.state === 'RENEWAL_DUE';
  const hasRefund = p.refundState && p.refundState !== 'NONE';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={PRODUCT_LINE_LABEL[p.productLine] ?? 'Policy'} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Header card */}
        <View style={styles.headCard}>
          <View style={styles.headRow}>
            <View style={styles.iconBox}><Icon size={24} color={InsuranceColors.brand} strokeWidth={2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{p.productName}</Text>
              <View style={styles.chipWrap}><StateChip state={p.state} /></View>
            </View>
          </View>
          <UnderwriterBadge disclosure={p.disclosure} onPress={() => setDisclosureOpen(true)} />
        </View>

        {/* Renewal banner */}
        {p.state === 'RENEWAL_DUE' ? (
          <Pressable style={styles.renewBanner} onPress={() => router.push(`/insurance/policies/${p.id}/renew`)}>
            <RefreshCw size={18} color={InsuranceColors.warnText} />
            <Text style={styles.renewText}>Renewal due — renew now to keep your cover active.</Text>
            <ChevronRight size={18} color={InsuranceColors.warnText} />
          </Pressable>
        ) : null}

        {/* Facts */}
        <View style={styles.card}>
          <PremiumRow label="Cover (sum insured)" amountKobo={p.sumInsuredKobo} />
          <PremiumRow label="Premium" amountKobo={p.premiumKobo} cadence={p.premiumCadence} />
          <PremiumRow label="Effective" value={new Date(p.effectiveAt).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })} />
          <PremiumRow label="Expires" value={new Date(p.expiresAt).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })} />
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <ActionRow icon={<FileBadge size={20} color={Colors.onSurfaceVariant} />} label="Certificate" onPress={() => router.push(`/insurance/policies/${p.id}/certificate`)} />
          <ActionRow icon={<Users size={20} color={Colors.onSurfaceVariant} />} label={`Beneficiaries${p.beneficiaries.length ? ` (${p.beneficiaries.length})` : ''}`} onPress={() => router.push(`/insurance/policies/${p.id}/beneficiaries`)} />
          {canRenew ? <ActionRow icon={<RefreshCw size={20} color={Colors.onSurfaceVariant} />} label="Renew policy" onPress={() => router.push(`/insurance/policies/${p.id}/renew`)} /> : null}
          {hasRefund ? <ActionRow icon={<History size={20} color={Colors.onSurfaceVariant} />} label="Refund status" onPress={() => router.push(`/insurance/policies/${p.id}/refund-status`)} /> : null}
          {canCancel ? <ActionRow icon={<Ban size={20} color={Colors.error} />} label="Cancel policy" danger onPress={() => router.push(`/insurance/policies/${p.id}/cancel`)} /> : null}
        </View>
      </ScrollView>

      <DisclosureSheet visible={disclosureOpen} disclosure={p.disclosure} onClose={() => setDisclosureOpen(false)} />
    </SafeAreaView>
  );
}

function ActionRow({ icon, label, onPress, danger }: { icon: React.ReactNode; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable style={styles.actionRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {icon}
      <Text style={[styles.actionLabel, danger && styles.actionDanger]}>{label}</Text>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 48, gap: Spacing.md },
  headCard: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, padding: Spacing.md, gap: Spacing.md },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconBox: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  chipWrap: { marginTop: Spacing.xs },
  renewBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, borderRadius: Radius.lg, padding: Spacing.md },
  renewText: { ...Typography.labelMd, color: InsuranceColors.warnText, flex: 1 },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  actions: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, overflow: 'hidden' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerLow },
  actionLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  actionDanger: { color: Colors.error },
});
