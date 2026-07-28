import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, Plus } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useClaims } from '@/features/insurance/claims';
import { InsuranceColors, formatNaira } from '@/features/insurance/constants/insurance.constants';
import ClaimStateChip from '@/features/insurance/components/claims-ClaimStateChip';
import type { Claim } from '@/features/insurance/claims';

export default function ClaimsList() {
  const claims = useClaims();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Claims"
        subtitle="Track and file claims"
        rightSlot={
          <Pressable onPress={() => router.push('/insurance/claims/start')} hitSlop={10} accessibilityLabel="File a new claim">
            <Plus size={22} color={InsuranceColors.brand} />
          </Pressable>
        }
      />

      {claims.isLoading ? (
        <StateView kind="loading" message="Loading your claims…" />
      ) : claims.isError ? (
        <StateView kind="error" title="Couldn't load claims" message="Check your connection and try again." actionLabel="Retry" onAction={() => claims.refetch()} />
      ) : (claims.data ?? []).length === 0 ? (
        <StateView
          kind="empty"
          title="No claims yet"
          message="If something happens to what you've insured, file a claim and we'll guide you through it."
          icon="FileText"
          actionLabel="File a claim"
          onAction={() => router.push('/insurance/claims/start')}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          {(claims.data ?? []).map((c) => (
            <ClaimRow key={c.id} claim={c} onPress={() => router.push(`/insurance/claims/status?id=${c.id}`)} />
          ))}
          <View style={styles.footerBtn}>
            <PrimaryButton label="File a new claim" variant="secondary" onPress={() => router.push('/insurance/claims/start')} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ClaimRow({ claim, onPress }: { claim: Claim; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{claim.policyName}</Text>
          <Text style={styles.sub} numberOfLines={1}>{claim.perilLabel}</Text>
        </View>
        <ChevronRight size={20} color={Colors.onSurfaceVariant} />
      </View>
      <View style={styles.metaRow}>
        <ClaimStateChip state={claim.state} />
        <Text style={styles.amount}>{formatNaira(claim.approvedAmountKobo ?? claim.claimedAmountKobo)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 48, gap: Spacing.md },
  card: {
    backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: InsuranceColors.border, padding: Spacing.md, gap: Spacing.sm,
  },
  pressed: { opacity: 0.9 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amount: { ...Typography.labelLg, color: InsuranceColors.text },
  footerBtn: { marginTop: Spacing.sm },
});
