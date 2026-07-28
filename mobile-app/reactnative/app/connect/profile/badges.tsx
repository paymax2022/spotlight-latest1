import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Camera,
  ShieldCheck,
  BadgeCheck,
  CircleCheck,
  Clock,
  Lock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useBadges } from '@/features/connect/profile/hooks';
import type { VerificationBadge, VerificationBadgeState } from '@/features/connect/profile/types';

// PR — Verification badges. Shows each verification, its state, and a path to
// verify when missing. Builds trust signals that gate higher tiers and matching.
const KIND_ICON = {
  selfie: Camera,
  identity: ShieldCheck,
  photo: BadgeCheck,
} as const;

const STATE_META: Record<
  VerificationBadgeState,
  { label: string; color: string; bg: string; Icon: typeof CircleCheck }
> = {
  verified: { label: 'Verified', color: ConnectColors.ok, bg: ConnectColors.okBg, Icon: CircleCheck },
  pending: { label: 'Pending', color: Colors.onWarning, bg: Colors.iconBgGold, Icon: Clock },
  unverified: { label: 'Not verified', color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh, Icon: Lock },
};

function BadgeCard({ badge }: { badge: VerificationBadge }) {
  const KindIcon = KIND_ICON[badge.kind];
  const state = STATE_META[badge.state];
  const StateIcon = state.Icon;

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.kindIcon}>
          <KindIcon size={22} color={ConnectColors.brand} strokeWidth={2} />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardLabel}>{badge.label}</Text>
          <Text style={styles.cardDesc}>{badge.description}</Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View style={[styles.statePill, { backgroundColor: state.bg }]}>
          <StateIcon size={14} color={state.color} strokeWidth={2.4} />
          <Text style={[styles.statePillText, { color: state.color }]}>{state.label}</Text>
        </View>

        {badge.state === 'unverified' ? (
          <PrimaryButton
            label="Verify now"
            variant="ghost"
            fullWidth={false}
            onPress={() => router.push('/connect/onboarding/verify-intro')}
          />
        ) : null}
      </View>
    </View>
  );
}

export default function ProfileBadges() {
  const { data, isLoading, error, refetch } = useBadges();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Verification badges" />

      {isLoading ? (
        <StateView kind="loading" message="Loading badges…" />
      ) : error || !data ? (
        <StateView
          kind="error"
          title="Couldn't load badges"
          icon="ShieldAlert"
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : data.length === 0 ? (
        <StateView
          kind="empty"
          title="No badges yet"
          message="Complete verification to earn trust badges."
          icon="ShieldCheck"
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <Text style={styles.intro}>
            Verified badges build trust and unlock higher tiers. They appear on
            both your Date and Network profiles.
          </Text>
          {data.map((badge) => (
            <BadgeCard key={badge.kind} badge={badge} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, paddingTop: Spacing.sm },
  intro: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md, lineHeight: 19 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  cardTop: { flexDirection: 'row', gap: Spacing.md },
  kindIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardLabel: { ...Typography.titleMd, color: Colors.onSurface },
  cardDesc: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2, lineHeight: 18 },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
  },
  statePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: Radius.full,
  },
  statePillText: { ...Typography.labelSm, fontWeight: '700' },
});
