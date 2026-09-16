import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Clock, Building2, Video, MapPin, Navigation, Phone, Star, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import StatusBadge from '@/features/realtor/components/StatusBadge';
import DetailRow from '@/features/realtor/components/DetailRow';
import { useInspection, useCancelInspection } from '@/features/realtor/hooks/useRealtor';
import { INSPECTION_STATUS_META } from '@/features/realtor/constants/realtor.constants';
import { formatSlotDate } from '@/features/realtor/utils/realtorFormatters';
import { confirmAsync } from '@/lib/confirm';

export default function InspectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const inspection = useInspection(String(id));
  const cancel = useCancelInspection();

  const onCancel = async () => {
    const ok = await confirmAsync({
      title: 'Cancel inspection?',
      message: 'The agent will be notified that you can no longer attend.',
      confirmLabel: 'Cancel inspection',
      cancelLabel: 'Keep it',
      destructive: true,
    });
    if (!ok) return;
    cancel.mutate(String(id));
  };

  if (inspection.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Inspection" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }
  if (inspection.isError || !inspection.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Inspection" />
        <StateView kind="error" title="Inspection not found" actionLabel="Back" onAction={() => goBack('/realtor/inspection')} />
      </SafeAreaView>
    );
  }

  const i = inspection.data;
  const meta = INSPECTION_STATUS_META[i.status];
  const active = i.status !== 'cancelled' && i.status !== 'no_show' && i.status !== 'completed';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Inspection detail" rightSlot={<StatusBadge label={meta.label} tone={meta.tone} />} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Pressable style={styles.listingCard} onPress={() => router.push(`/realtor/listing/${i.listingId}`)}>
          <Image source={{ uri: i.listingCoverUrl }} style={styles.thumb} />
          <View style={styles.listingInfo}>
            <Text style={styles.listingTitle} numberOfLines={2}>{i.listingTitle}</Text>
            <Text style={styles.listingSub}>{i.area}, {i.city}</Text>
          </View>
        </Pressable>

        <View style={styles.card}>
          <DetailRow label="Date & time" value={`${formatSlotDate(i.date)} · ${i.time}`} />
          <DetailRow label="Viewing type" value={i.viewingMode === 'physical' ? 'In-person' : 'Virtual tour'} />
          <DetailRow label="Attendee" value={i.attendeeName} />
          <DetailRow label="Phone" value={i.attendeePhone} />
          {i.note ? <DetailRow label="Note" value={i.note} /> : null}
        </View>

        {/* Location */}
        <View style={styles.locationCard}>
          <View style={styles.locationHead}>
            <MapPin size={16} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.locationText}>{i.address}</Text>
          </View>
          <Pressable style={styles.directionsBtn} accessibilityRole="button" accessibilityLabel="Get directions">
            <Navigation size={16} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.directionsText}>Get directions</Text>
          </Pressable>
        </View>

        {/* Agent */}
        <View style={styles.agentCard}>
          <Image source={{ uri: i.agent.avatarUrl }} style={styles.agentAvatar} />
          <View style={styles.agentInfo}>
            <View style={styles.agentNameRow}>
              <Text style={styles.agentName} numberOfLines={1}>{i.agent.name}</Text>
              {i.agent.verified ? <ShieldCheck size={14} color={Colors.tertiaryContainer} strokeWidth={2.4} /> : null}
            </View>
            <View style={styles.agentMeta}>
              <Star size={13} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
              <Text style={styles.agentMetaText}>{i.agent.rating.toFixed(1)} · {i.agent.reviewCount} reviews</Text>
            </View>
          </View>
          <Pressable style={styles.callBtn} accessibilityRole="button" accessibilityLabel="Call agent">
            <Phone size={18} color={Colors.secondary} strokeWidth={2} />
          </Pressable>
        </View>

        {/* Convert to application — the funnel hand-off */}
        {i.status === 'completed' || i.canConvertToApplication ? (
          <View style={styles.convertCard}>
            <Text style={styles.convertTitle}>Liked what you saw?</Text>
            <Text style={styles.convertSub}>Turn this viewing into a rental application in a few steps.</Text>
            <PrimaryButton
              label="Apply for this property"
              onPress={() => router.push(`/realtor/apply?listingId=${i.listingId}&inspectionId=${i.id}`)}
            />
          </View>
        ) : null}
      </ScrollView>

      {active ? (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Reschedule" variant="secondary" onPress={() => router.push(`/realtor/inspection/book?listingId=${i.listingId}`)} />
          <Pressable onPress={onCancel} style={styles.cancelBtn} disabled={cancel.isPending}>
            <Text style={styles.cancelText}>{cancel.isPending ? 'Cancelling…' : 'Cancel inspection'}</Text>
          </Pressable>
        </SafeAreaView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  listingCard: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.sm,
    ...shadow1,
  },
  thumb: { width: 80, height: 80, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  listingInfo: { flex: 1, justifyContent: 'center', gap: 4 },
  listingTitle: { ...Typography.labelLg, color: Colors.onSurface },
  listingSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  locationCard: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  locationHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  locationText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  directionsBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  directionsText: { ...Typography.labelMd, color: Colors.secondary },
  agentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
  },
  agentAvatar: { width: 48, height: 48, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  agentInfo: { flex: 1, gap: 2 },
  agentNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  agentName: { ...Typography.titleMd, color: Colors.onSurface },
  agentMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  agentMetaText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  callBtn: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  convertCard: {
    backgroundColor: Colors.primaryFixed,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  convertTitle: { ...Typography.titleMd, color: Colors.onPrimaryFixed },
  convertSub: { ...Typography.bodySm, color: Colors.onPrimaryFixedVariant, marginBottom: Spacing.sm },
  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerLow,
    backgroundColor: Colors.surfaceContainerLowest,
    gap: Spacing.sm,
  },
  cancelBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  cancelText: { ...Typography.labelMd, color: Colors.error },
});
