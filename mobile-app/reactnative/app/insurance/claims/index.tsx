// ── Protection — claims ──────────────────────────────────────────────────────
// Claims are READ here and FILED elsewhere, and that is not a shortcut — it is
// the shape of the integration.
//
// MyCover has no claim-filing REST endpoint (`POST /claims` is a 404). It runs
// claims through its own hosted flow and gives the distributor a per-policy link
// when the policy is issued; progress then arrives over webhooks. So the honest
// design is: list the claims we know about, and hand a person off to their
// insurer's flow with the right policy already identified.
//
// Building a claim form here that posted nowhere would be the worst of both —
// it would look like it worked.

import React from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, LifeBuoy, Plus } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import {
  InsuranceErrorState,
  PolicyListSkeleton,
  StatusPill,
} from '@/features/insurance/components/live';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import { useLiveClaims, useLivePolicies } from '@/features/insurance/live/hooks';
import { nairaFromKobo } from '@/features/insurance/live/money';
import type { Claim } from '@/features/insurance/live/types';

export default function ClaimsList() {
  const claims = useLiveClaims();
  const policies = useLivePolicies();

  const rows = claims.data ?? [];
  const claimablePolicies = (policies.data ?? []).filter(
    (p) => p.status === 'active' && !!p.claimUrl,
  );

  if (claims.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Claims" />
        <PolicyListSkeleton count={2} />
      </SafeAreaView>
    );
  }

  if (claims.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Claims" />
        <InsuranceErrorState error={claims.error} onRetry={() => claims.refetch()} />
      </SafeAreaView>
    );
  }

  if (rows.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Claims" />
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <LifeBuoy size={30} color={InsuranceColors.brand} strokeWidth={1.8} />
          </View>
          <Text style={styles.emptyTitle}>No claims — and long may it last</Text>
          <Text style={styles.emptyBody}>
            If something happens to what you've insured, start a claim from the policy itself. We
            pass your details straight to the insurer and track their answer here.
          </Text>

          {claimablePolicies.length > 0 ? (
            <PrimaryButton
              label="Start a claim"
              onPress={() => router.push('/insurance/claims/start')}
            />
          ) : (
            <>
              <Text style={styles.emptyHint}>
                You'll be able to claim once you have active cover.
              </Text>
              <PrimaryButton
                label="Find cover"
                variant="secondary"
                onPress={() => router.push('/insurance/browse')}
              />
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Claims"
        subtitle={`${rows.length} ${rows.length === 1 ? 'claim' : 'claims'}`}
        rightSlot={
          claimablePolicies.length > 0 ? (
            <Pressable
              onPress={() => router.push('/insurance/claims/start')}
              hitSlop={10}
              accessibilityLabel="Start a new claim"
            >
              <Plus size={22} color={InsuranceColors.brand} />
            </Pressable>
          ) : null
        }
      />

      <FlatList
        data={rows}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={claims.isFetching}
            onRefresh={() => claims.refetch()}
            tintColor={Colors.primary}
          />
        }
        renderItem={({ item }) => (
          <ClaimRow
            claim={item}
            onPress={() => router.push(`/insurance/claims/status?id=${encodeURIComponent(item.id)}`)}
          />
        )}
      />
    </SafeAreaView>
  );
}

function ClaimRow({ claim, onPress }: { claim: Claim; onPress: () => void }) {
  const amountKobo = claim.approvedAmountKobo ?? claim.claimedAmountKobo;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.topRow}>
        <View style={styles.grow}>
          <Text style={styles.title} numberOfLines={1}>
            {claim.claimRef || 'Claim'}
          </Text>
          <Text style={styles.sub} numberOfLines={2}>
            {claim.description || 'No description provided'}
          </Text>
        </View>
        <ChevronRight size={20} color={Colors.onSurfaceVariant} />
      </View>
      <View style={styles.metaRow}>
        <StatusPill status={claim.status} kind="claim" />
        <View style={styles.grow} />
        {amountKobo > 0 ? (
          <Text style={styles.amount}>
            {claim.approvedAmountKobo != null ? 'Approved ' : 'Claimed '}
            {nairaFromKobo(amountKobo)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  grow: { flex: 1 },
  list: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: 56,
    gap: Spacing.md,
  },
  card: {
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  pressed: { opacity: 0.9 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2, lineHeight: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  amount: { ...Typography.labelMd, color: Colors.onSurface },

  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  emptyTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  emptyBody: {
    ...Typography.bodySm,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 21,
  },
  emptyHint: {
    ...Typography.labelSm,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
  },
});
