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
import { useClaimablePolicies } from '@/features/insurance/claims';
import { UnderwriterBadge } from '@/features/insurance/components';
import { InsuranceColors, formatNaira } from '@/features/insurance/constants/insurance.constants';
import type { Policy } from '@/features/insurance/types';

/** FNOL start (PRD §15.1): pick the active policy to file a claim against. */
export default function ClaimStart() {
  const policies = useClaimablePolicies();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="File a claim" subtitle="Choose the cover affected" />

      {policies.isLoading ? (
        <StateView kind="loading" message="Loading your active cover…" />
      ) : policies.isError ? (
        <StateView kind="error" title="Couldn't load policies" actionLabel="Retry" onAction={() => policies.refetch()} />
      ) : (policies.data ?? []).length === 0 ? (
        <StateView
          kind="empty"
          title="No active cover"
          message="You need an active policy to file a claim."
          icon="ShieldCheck"
          actionLabel="Browse cover"
          onAction={() => router.push('/insurance/browse')}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          <Text style={styles.hint}>Select the policy you're claiming against. Only active cover can be claimed.</Text>
          {(policies.data ?? []).map((p) => (
            <PolicyPick key={p.id} policy={p} onPress={() => router.push(`/insurance/claims/form?policyId=${p.id}`)} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function PolicyPick({ policy, onPress }: { policy: Policy; onPress: () => void }) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[policy.icon] ?? Icons.ShieldCheck;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.topRow}>
        <View style={styles.iconBox}><Icon size={22} color={InsuranceColors.brand} strokeWidth={2} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{policy.productName}</Text>
          <Text style={styles.sub}>Cover {formatNaira(policy.sumInsuredKobo)}</Text>
        </View>
        <ChevronRight size={20} color={Colors.onSurfaceVariant} />
      </View>
      <UnderwriterBadge disclosure={policy.disclosure} compact />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 48, gap: Spacing.md },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  card: {
    backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: InsuranceColors.border, padding: Spacing.md, gap: Spacing.sm,
  },
  pressed: { opacity: 0.9 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
