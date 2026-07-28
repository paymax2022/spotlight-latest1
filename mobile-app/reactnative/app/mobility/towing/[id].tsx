import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Phone, CheckCircle2, X, Wrench } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import ScreenHeader from '@/components/ScreenHeader';
import MobilityMap from '@/features/mobility/components/MobilityMap';
import TripPinDisplay from '@/features/mobility/components/TripPinDisplay';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useTowingJob, useCancelTowing } from '@/features/mobility/hooks/useModes';
import { TOWING_PHASE_LABEL } from '@/features/mobility/constants/modes.constants';
import { formatNairaWhole, formatEta } from '@/features/mobility/utils/mobilityFormatters';

const ACTIVE = ['requested', 'operator_accepted', 'operator_en_route', 'pin_verified', 'in_progress'];

export default function TowingTrackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const job = useTowingJob(id, { poll: true });
  const cancel = useCancelTowing();
  const j = job.data;

  if (job.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Roadside help" showBack={false} /><StateView kind="loading" message="Loading…" /></SafeAreaView>
    );
  }
  if (job.isError || !j) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Roadside help" /><MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => job.refetch()} /></SafeAreaView>
    );
  }

  const isActive = ACTIVE.includes(j.phase);
  const showPin = (j.phase === 'operator_en_route' || j.phase === 'operator_accepted') && j.towPin;
  const paymentFailed = j.paymentStatus === 'failed';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Roadside help" showBack={!isActive} onBack={() => router.replace('/mobility')} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {paymentFailed && <MobilityEdgeState kind="paymentFailed" compact actionLabel="Top up wallet" onAction={() => router.push('/wallet/add')} />}

        <View style={styles.statusRow}>
          <StatusBadge label={TOWING_PHASE_LABEL[j.phase]} tone={j.phase === 'completed' ? 'success' : j.phase === 'cancelled' ? 'danger' : 'info'} />
          {j.operatorEtaS != null && isActive && <Text style={styles.eta}>ETA {formatEta(j.operatorEtaS)}</Text>}
        </View>

        {isActive && (
          <MobilityMap height={160} showRoute pickup={j.pickup} dropoff={j.dest} caption={TOWING_PHASE_LABEL[j.phase]} />
        )}

        {/* Operator */}
        {j.operator && (
          <View style={[styles.operatorCard, shadow1]}>
            <View style={styles.avatar}><Wrench size={20} color={Colors.primary} strokeWidth={2.2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.operatorName}>{j.operator.name}</Text>
              <Text style={styles.operatorMeta}>{j.operator.truck} · ★ {j.operator.rating.toFixed(2)}</Text>
            </View>
            <Pressable style={styles.callBtn} accessibilityLabel="Call operator"><Phone size={18} color={Colors.primary} strokeWidth={2} /></Pressable>
          </View>
        )}

        {/* Tow PIN */}
        {showPin && j.towPin && (
          <TripPinDisplay pin={j.towPin} hint="Give this PIN to the operator before they start the tow." />
        )}

        {/* Completed */}
        {j.phase === 'completed' && (
          <View style={styles.doneCard}>
            <CheckCircle2 size={40} color={Colors.tertiaryContainer} strokeWidth={2} />
            <Text style={styles.doneTitle}>Service complete</Text>
            <Text style={styles.doneSub}>{formatNairaWhole(j.fareKobo)} settled from your wallet.</Text>
          </View>
        )}

        <View style={styles.fareCard}>
          <Text style={styles.fareCardLabel}>Service fare</Text>
          <Text style={styles.fareCardValue}>{formatNairaWhole(j.fareKobo)}</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {j.phase === 'completed' && !j.rated ? (
          <PrimaryButton label="Rate operator" onPress={() => router.replace(`/mobility/towing/${j.id}/rate`)} />
        ) : j.phase === 'completed' || j.phase === 'cancelled' ? (
          <PrimaryButton label="Done" onPress={() => router.replace('/mobility')} />
        ) : (
          <Pressable style={styles.cancelBtn} onPress={() => id && cancel.mutate(id, { onSuccess: () => router.replace('/mobility') })} disabled={cancel.isPending}>
            <X size={16} color={Colors.error} strokeWidth={2} />
            <Text style={styles.cancelText}>{cancel.isPending ? 'Cancelling…' : 'Cancel request'}</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eta: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
  operatorCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  operatorName: { ...Typography.labelLg, color: Colors.onSurface },
  operatorMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  callBtn: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  doneCard: { alignItems: 'center', gap: 6, paddingVertical: Spacing.md },
  doneTitle: { ...Typography.headlineMd, color: Colors.onSurface, marginTop: Spacing.xs },
  doneSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  fareCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  fareCardLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  fareCardValue: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52 },
  cancelText: { ...Typography.labelMd, color: Colors.error },
});
