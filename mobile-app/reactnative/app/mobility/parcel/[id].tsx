import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Phone, ShieldCheck, CheckCircle2, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import ScreenHeader from '@/components/ScreenHeader';
import MapPlaceholder from '@/features/mobility/components/MapPlaceholder';
import TripRouteCard from '@/features/mobility/components/TripRouteCard';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useParcel, useCancelParcel } from '@/features/mobility/hooks/useModes';
import { PARCEL_PHASE_LABEL } from '@/features/mobility/constants/modes.constants';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';

const ACTIVE_PHASES = ['created', 'courier_assigned', 'pickup_pin_verified', 'picked_up', 'in_transit'];

export default function ParcelTrackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const parcel = useParcel(id, { poll: true });
  const cancel = useCancelParcel();
  const p = parcel.data;

  if (parcel.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Your delivery" showBack={false} />
        <StateView kind="loading" message="Loading delivery…" />
      </SafeAreaView>
    );
  }
  if (parcel.isError || !p) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Your delivery" />
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => parcel.refetch()} />
      </SafeAreaView>
    );
  }

  const isActive = ACTIVE_PHASES.includes(p.phase);
  const paymentFailed = p.paymentStatus === 'failed';

  const onCancel = () => {
    if (!id) return;
    cancel.mutate(id, { onSuccess: () => router.replace('/mobility') });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your delivery" showBack={!isActive} onBack={() => router.replace('/mobility')} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {paymentFailed && <MobilityEdgeState kind="paymentFailed" compact actionLabel="Top up wallet" onAction={() => router.push('/wallet/add')} />}

        <View style={styles.statusRow}>
          <StatusBadge label={PARCEL_PHASE_LABEL[p.phase]} tone={p.phase === 'delivered' ? 'success' : p.phase === 'cancelled' ? 'danger' : 'info'} />
          <Text style={styles.fare}>{formatNairaWhole(p.fareKobo)}</Text>
        </View>

        {isActive && <MapPlaceholder height={150} showRoute caption={PARCEL_PHASE_LABEL[p.phase]} />}

        <TripRouteCard pickup={p.pickup} dest={p.dropoff} />

        {/* Courier */}
        {p.courier && (
          <View style={[styles.courierCard, shadow1]}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{p.courier.name.charAt(0)}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.courierName}>{p.courier.name}</Text>
              <Text style={styles.courierMeta}>{p.courier.vehicle} · ★ {p.courier.rating.toFixed(2)}</Text>
            </View>
            <Pressable style={styles.callBtn} accessibilityLabel="Call courier"><Phone size={18} color={Colors.primary} strokeWidth={2} /></Pressable>
          </View>
        )}

        {/* PINs (sender sees both) */}
        {(p.pickupPin || p.dropoffPin) && (
          <View style={styles.pinCard}>
            <View style={styles.pinHead}>
              <ShieldCheck size={16} color={Colors.primary} strokeWidth={2.2} />
              <Text style={styles.pinHeadText}>Verification PINs</Text>
            </View>
            <View style={styles.pinRow}>
              {p.pickupPin && (
                <View style={styles.pinCol}>
                  <Text style={styles.pinLabel}>PICKUP PIN</Text>
                  <Text style={styles.pinValue}>{p.pickupPin}</Text>
                  <Text style={styles.pinHint}>Give to the courier at pickup</Text>
                </View>
              )}
              {p.dropoffPin && (
                <View style={styles.pinCol}>
                  <Text style={styles.pinLabel}>DELIVERY PIN</Text>
                  <Text style={styles.pinValue}>{p.dropoffPin}</Text>
                  <Text style={styles.pinHint}>Receiver gives this on delivery</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Delivered confirmation */}
        {p.phase === 'delivered' && (
          <View style={styles.deliveredCard}>
            <CheckCircle2 size={40} color={Colors.tertiaryContainer} strokeWidth={2} />
            <Text style={styles.deliveredTitle}>Delivered</Text>
            <Text style={styles.deliveredSub}>Proof of delivery captured and {formatNairaWhole(p.fareKobo)} settled.</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {p.phase === 'delivered' && !p.rated ? (
          <PrimaryButton label="Rate courier" onPress={() => router.replace(`/mobility/parcel/${p.id}/rate`)} />
        ) : p.phase === 'delivered' || p.phase === 'cancelled' ? (
          <PrimaryButton label="Done" onPress={() => router.replace('/mobility')} />
        ) : (
          <Pressable style={styles.cancelBtn} onPress={onCancel} disabled={cancel.isPending}>
            <X size={16} color={Colors.error} strokeWidth={2} />
            <Text style={styles.cancelText}>{cancel.isPending ? 'Cancelling…' : 'Cancel delivery'}</Text>
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
  fare: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  courierCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.titleMd, color: Colors.primary, fontWeight: '700' as const },
  courierName: { ...Typography.labelLg, color: Colors.onSurface },
  courierMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  callBtn: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  pinCard: { backgroundColor: Colors.primaryFixed, borderRadius: Radius.lg, padding: Spacing.md },
  pinHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.sm },
  pinHeadText: { ...Typography.labelMd, color: Colors.onPrimaryFixed },
  pinRow: { flexDirection: 'row', gap: Spacing.sm },
  pinCol: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md, padding: Spacing.md, alignItems: 'center', gap: 2 },
  pinLabel: { ...Typography.caption, color: Colors.onSurfaceVariant, letterSpacing: 1 },
  pinValue: { ...Typography.headlineMd, color: Colors.primary, fontWeight: '800' as const },
  pinHint: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
  deliveredCard: { alignItems: 'center', gap: 6, paddingVertical: Spacing.md },
  deliveredTitle: { ...Typography.headlineMd, color: Colors.onSurface, marginTop: Spacing.xs },
  deliveredSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52 },
  cancelText: { ...Typography.labelMd, color: Colors.error },
});
