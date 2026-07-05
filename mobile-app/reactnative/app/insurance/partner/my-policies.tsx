import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ChevronRight } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { usePartnerPolicies } from '@/features/insurance/partner';
import { UnderwriterBadge } from '@/features/insurance/components';
import { POLICY_STATE_LABEL, InsuranceColors, formatNaira, CADENCE_SUFFIX } from '@/features/insurance/constants/insurance.constants';
import type { PartnerPolicy } from '@/features/insurance/partner';

/** Partner/driver: my embedded policies (PRD §15.3). */
export default function PartnerMyPolicies() {
  const policies = usePartnerPolicies();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My cover" subtitle="Driver & vehicle protection" />

      {policies.isLoading ? (
        <StateView kind="loading" message="Loading your cover…" />
      ) : policies.isError ? (
        <StateView kind="error" title="Couldn't load cover" actionLabel="Retry" onAction={() => policies.refetch()} />
      ) : (policies.data ?? []).length === 0 ? (
        <StateView
          kind="empty"
          title="No cover yet"
          message="Complete onboarding to activate your driver protection."
          icon="ShieldCheck"
          actionLabel="Onboarding cover"
          onAction={() => router.push('/insurance/partner/onboarding-consent')}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          <Pressable style={styles.tripBtn} onPress={() => router.push('/insurance/partner/trip-cover')} accessibilityRole="button">
            <Text style={styles.tripBtnText}>View current trip cover</Text>
            <ChevronRight size={18} color={InsuranceColors.brand} />
          </Pressable>
          {(policies.data ?? []).map((p) => (
            <PolicyRow key={p.id} policy={p} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function PolicyRow({ policy }: { policy: PartnerPolicy }) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[policy.icon] ?? Icons.ShieldCheck;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/insurance/partner/file-claim?policyId=${policy.id}`)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.topRow}>
        <View style={styles.iconBox}><Icon size={22} color={InsuranceColors.octamile} strokeWidth={2} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{policy.productName}</Text>
          <Text style={styles.sub}>Cover {formatNaira(policy.sumInsuredKobo)} · {POLICY_STATE_LABEL[policy.state] ?? policy.state}</Text>
        </View>
        <ChevronRight size={20} color={Colors.onSurfaceVariant} />
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.premium}>{formatNaira(policy.premiumKobo)}{CADENCE_SUFFIX[policy.premiumCadence] ?? ''}</Text>
        <Text style={styles.expiry}>Renews {new Date(policy.expiresAt).toLocaleDateString('en-NG', { dateStyle: 'medium' } as any)}</Text>
      </View>
      <UnderwriterBadge disclosure={policy.disclosure} compact />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 48, gap: Spacing.md },
  tripBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: InsuranceColors.surfaceAlt, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: InsuranceColors.border },
  tripBtnText: { ...Typography.labelLg, color: InsuranceColors.text },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, padding: Spacing.md, gap: Spacing.sm },
  pressed: { opacity: 0.9 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: InsuranceColors.octamileBg, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  premium: { ...Typography.labelLg, color: InsuranceColors.text },
  expiry: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
