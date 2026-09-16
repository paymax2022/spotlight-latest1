// ── Protection — start a claim ───────────────────────────────────────────────
// Pick the policy, then hand off to the insurer's own hosted claim flow.
//
// There is no API to post a claim to — MyCover issues a per-policy claim link
// when the policy is bound and runs the whole process itself, reporting progress
// back over webhooks. So the useful thing this screen can do is remove the part
// people actually get stuck on: working out which policy covers what happened,
// and finding the link at all.

import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, ExternalLink, Info } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { alertAsync } from '@/lib/confirm';
import {
  InsuranceErrorState,
  PolicyListSkeleton,
  UnderwriterMark,
} from '@/features/insurance/components/live';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import { useLivePolicies } from '@/features/insurance/live/hooks';
import type { Policy } from '@/features/insurance/live/types';

export default function StartClaim() {
  const policies = useLivePolicies();

  const rows = policies.data ?? [];
  const claimable = rows.filter((p) => p.status === 'active' && !!p.claimUrl);
  const notClaimable = rows.filter((p) => p.status === 'active' && !p.claimUrl);

  const openClaim = async (policy: Policy) => {
    const url = policy.claimUrl;
    if (!url) return;
    const ok = await Linking.canOpenURL(url);
    if (!ok) {
      await alertAsync({
        title: "Couldn't open the claim form",
        message: `Please contact ${policy.underwriter || 'your insurer'} directly, quoting policy ${policy.policyRef}.`,
      });
      return;
    }
    Linking.openURL(url);
  };

  if (policies.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Start a claim" />
        <PolicyListSkeleton count={2} />
      </SafeAreaView>
    );
  }

  if (policies.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Start a claim" />
        <InsuranceErrorState error={policies.error} onRetry={() => policies.refetch()} />
      </SafeAreaView>
    );
  }

  if (claimable.length === 0 && notClaimable.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Start a claim" />
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>You have no active cover</Text>
          <Text style={styles.emptyBody}>
            A claim has to be made against a policy that was in force when the loss happened.
          </Text>
          <PrimaryButton label="Find cover" onPress={() => router.replace('/insurance/browse')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Start a claim" subtitle="Which policy is this about?" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.notice}>
          <Info size={17} color={InsuranceColors.brand} />
          <Text style={styles.noticeText}>
            Claims are handled by your insurer directly. We'll take you to their form with your
            policy already filled in, and track their decision back here.
          </Text>
        </View>

        {claimable.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => openClaim(p)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <UnderwriterMark underwriter={p.underwriter} size={36} />
            <View style={styles.grow}>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {p.productName}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {p.underwriter} · {p.policyRef}
              </Text>
            </View>
            <ExternalLink size={18} color={InsuranceColors.brand} />
          </Pressable>
        ))}

        {/* An active policy with no claim link is a real situation worth naming
            — the insurer has not published one — rather than silently omitting
            the policy and leaving the user to wonder where it went. */}
        {notClaimable.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Claim these directly with the insurer</Text>
            {notClaimable.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => router.push(`/insurance/policies/${encodeURIComponent(p.id)}`)}
                style={({ pressed }) => [styles.row, styles.rowMuted, pressed && styles.pressed]}
              >
                <UnderwriterMark underwriter={p.underwriter} size={36} />
                <View style={styles.grow}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {p.productName}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {p.underwriter} hasn't published an online claim form
                  </Text>
                </View>
                <ChevronRight size={18} color={Colors.onSurfaceVariant} />
              </Pressable>
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  grow: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 48, gap: Spacing.md },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  noticeText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 20 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    padding: Spacing.md,
  },
  rowMuted: { backgroundColor: Colors.surfaceContainerLow },
  pressed: { opacity: 0.9 },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },

  emptyWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  emptyTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  emptyBody: {
    ...Typography.bodySm,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 21,
  },
});
