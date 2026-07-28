import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Switch, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, TrendingUp, Inbox, BadgePercent, Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useDriverHome, useDriverEarnings } from '@/features/mobility/hooks/useMobility';
import { toMobilityError, formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import { COMMISSION_TIER_LABEL } from '@/features/mobility/constants/mobility.constants';

export default function DriverHomeScreen() {
  const { me, setStatus } = useDriverHome();
  const earnings = useDriverEarnings();
  const [error, setError] = useState<string | null>(null);

  const profile = me.data;
  const approved = profile?.verificationStatus === 'approved';

  const toggleOnline = (next: boolean) => {
    setError(null);
    setStatus.mutate(
      { status: next ? 'online' : 'offline', loc: { lat: 6.45, lng: 3.46 } },
      { onError: (e) => setError(toMobilityError(e).message) },
    );
  };

  if (me.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Driver" />
        <StateView kind="loading" message="Loading your driver profile…" />
      </SafeAreaView>
    );
  }

  if (me.isError || !profile) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Driver" />
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => me.refetch()} />
      </SafeAreaView>
    );
  }

  // Not approved yet → route to onboarding/status (restricted state).
  if (!approved) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Become a driver" />
        <View style={styles.gateBody}>
          <View style={styles.gateIcon}><TrendingUp size={32} color={Colors.primary} strokeWidth={2} /></View>
          <Text style={styles.gateTitle}>Drive with Paymax</Text>
          <Text style={styles.gateSub}>
            {profile.verificationStatus === 'not_started'
              ? 'Complete a quick onboarding to start earning. Submit your details, upload documents and add your vehicle.'
              : 'Your application is in progress. We will notify you once it is reviewed.'}
          </Text>
          <View style={styles.gateStatus}>
            <Text style={styles.gateStatusLabel}>Status</Text>
            <StatusBadge verification={profile.verificationStatus} />
          </View>
          {profile.rejectionReason ? <Text style={styles.rejectReason}>{profile.rejectionReason}</Text> : null}
          <PrimaryButton
            label={profile.verificationStatus === 'not_started' ? 'Start onboarding' : 'Continue onboarding'}
            onPress={() => router.push('/mobility/driver/onboarding')}
            style={{ marginTop: Spacing.lg }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Driver home" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={me.isRefetching} onRefresh={() => { me.refetch(); earnings.refetch(); }} tintColor={Colors.primary} />}
      >
        {/* Online toggle */}
        <View style={[styles.onlineCard, profile.online && styles.onlineCardActive, shadow1]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.onlineLabel, profile.online && styles.onlineLabelActive]}>
              {profile.online ? "You're online" : "You're offline"}
            </Text>
            <Text style={[styles.onlineSub, profile.online && styles.onlineSubActive]}>
              {profile.online ? 'Receiving ride requests' : 'Go online to receive requests'}
            </Text>
          </View>
          <Switch
            value={profile.online}
            onValueChange={toggleOnline}
            disabled={setStatus.isPending}
            trackColor={{ false: Colors.outlineVariant, true: Colors.tertiaryFixedDim }}
            thumbColor={profile.online ? Colors.tertiaryContainer : Colors.surfaceContainerLowest}
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {profile.online && (
          <Pressable style={styles.requestsBtn} onPress={() => router.push('/mobility/driver/requests')}>
            <View style={styles.requestsIcon}><Inbox size={20} color={Colors.onPrimary} strokeWidth={2.2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.requestsTitle}>Incoming requests</Text>
              <Text style={styles.requestsSub}>See nearby riders waiting for a driver</Text>
            </View>
            <ChevronRight size={20} color={Colors.onPrimary} />
          </Pressable>
        )}

        {/* Earnings summary */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Earnings</Text>
            <Pressable onPress={() => router.push('/mobility/driver/earnings')} hitSlop={8}>
              <Text style={styles.link}>Details</Text>
            </Pressable>
          </View>
          {earnings.isLoading ? (
            <StateView kind="loading" compact />
          ) : earnings.isError ? (
            <MobilityEdgeState kind="offline" compact actionLabel="Retry" onAction={() => earnings.refetch()} />
          ) : earnings.data ? (
            <>
              <View style={styles.earnRow}>
                <View style={styles.earnCol}>
                  <Text style={styles.earnLabel}>Today</Text>
                  <Text style={styles.earnValue}>{formatNairaWhole(earnings.data.today.grossKobo)}</Text>
                  <Text style={styles.earnMeta}>{earnings.data.today.tripsCompleted} trips</Text>
                </View>
                <View style={styles.earnDivider} />
                <View style={styles.earnCol}>
                  <Text style={styles.earnLabel}>Net (all time)</Text>
                  <Text style={styles.earnValue}>{formatNairaWhole(earnings.data.netKobo)}</Text>
                  <Text style={styles.earnMeta}>{earnings.data.tripsCompleted} trips</Text>
                </View>
              </View>
            </>
          ) : null}
        </View>

        {/* Commission tier */}
        <View style={[styles.tierCard, shadow1]}>
          <View style={styles.tierIcon}><BadgePercent size={20} color={Colors.primary} strokeWidth={2.2} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.tierLabel}>Commission tier</Text>
            <Text style={styles.tierValue}>
              {COMMISSION_TIER_LABEL[profile.commission.tier]} · you keep {profile.commission.driverPct}%
            </Text>
          </View>
        </View>

        {/* Wallet shortcut */}
        <Pressable style={styles.walletRow} onPress={() => router.push('/(tabs)/wallet')}>
          <View style={styles.walletIcon}><Wallet size={18} color={Colors.secondary} strokeWidth={2} /></View>
          <Text style={styles.walletLabel}>Driver wallet & payouts</Text>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  gateBody: { padding: Spacing.containerMargin, alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xl },
  gateIcon: { width: 72, height: 72, borderRadius: Radius.xl, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  gateTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  gateSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 22 },
  gateStatus: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md },
  gateStatusLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  rejectReason: { ...Typography.labelSm, color: Colors.error, textAlign: 'center', marginTop: Spacing.sm },
  onlineCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.outlineVariant },
  onlineCardActive: { backgroundColor: Colors.tertiaryFixed, borderColor: Colors.tertiaryFixedDim },
  onlineLabel: { ...Typography.titleMd, color: Colors.onSurface },
  onlineLabelActive: { color: Colors.tertiaryContainer },
  onlineSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  onlineSubActive: { color: Colors.tertiaryContainer },
  error: { ...Typography.labelSm, color: Colors.error },
  requestsBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.md },
  requestsIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  requestsTitle: { ...Typography.labelLg, color: Colors.onPrimary },
  requestsSub: { ...Typography.labelSm, color: Colors.inversePrimary },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.outlineVariant },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  link: { ...Typography.labelMd, color: Colors.secondary },
  earnRow: { flexDirection: 'row', alignItems: 'center' },
  earnCol: { flex: 1, gap: 2 },
  earnDivider: { width: 1, alignSelf: 'stretch', backgroundColor: Colors.outlineVariant, marginHorizontal: Spacing.md },
  earnLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  earnValue: { ...Typography.headlineMd, color: Colors.onSurface, fontWeight: '800' as const },
  earnMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  tierCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  tierIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  tierLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  tierValue: { ...Typography.labelLg, color: Colors.onSurface },
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  walletIcon: { width: 38, height: 38, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  walletLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
});
