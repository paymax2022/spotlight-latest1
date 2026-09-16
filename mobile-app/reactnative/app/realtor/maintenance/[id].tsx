import React, { useState } from 'react';
import { View, Text, Image, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Check, Star, Phone, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import SectionHeader from '@/components/SectionHeader';
import StatusBadge from '@/features/realtor/components/StatusBadge';
import DetailRow from '@/features/realtor/components/DetailRow';
import {
  useMaintenanceRequest, useApproveQuote, useRejectQuote, useConfirmCompletion, useRateRequest,
} from '@/features/realtor/hooks/useRealtorMaintenance';
import { CATEGORY_LABEL, MAINT_STATUS_META, URGENCY_META } from '@/features/realtor/constants/realtor.maintenance.constants';
import { formatNaira } from '@/features/realtor/utils/realtorFormatters';

export default function MaintenanceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const req = useMaintenanceRequest(String(id));
  const approve = useApproveQuote();
  const reject = useRejectQuote();
  const confirm = useConfirmCompletion();
  const rate = useRateRequest();
  const [stars, setStars] = useState(0);

  if (req.isLoading) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Request" /><StateView kind="loading" /></SafeAreaView>;
  }
  if (req.isError || !req.data) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Request" /><StateView kind="error" title="Request not found" actionLabel="Back" onAction={() => goBack('/realtor/maintenance')} /></SafeAreaView>;
  }

  const r = req.data;
  const meta = MAINT_STATUS_META[r.status];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Maintenance request" rightSlot={<StatusBadge label={meta.label} tone={meta.tone} />} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{r.title}</Text>
        <View style={styles.badges}>
          <StatusBadge label={CATEGORY_LABEL[r.category]} tone="neutral" />
          <StatusBadge label={URGENCY_META[r.urgency].label} tone={URGENCY_META[r.urgency].tone} />
          {r.emergencyBypass ? <StatusBadge label="Emergency dispatch" tone="error" icon="Siren" /> : null}
        </View>
        <Text style={styles.desc}>{r.description}</Text>

        {r.media.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
            {r.media.map((m) => <Image key={m.id} source={{ uri: m.url }} style={styles.photo} />)}
          </ScrollView>
        ) : null}

        {/* Timeline */}
        <SectionHeader title="Progress" style={styles.sectionFlush} />
        <View style={styles.card}>
          {r.timeline.map((step, idx) => (
            <View key={step.key} style={styles.tlRow}>
              <View style={styles.tlRail}>
                <View style={[styles.tlDot, step.state === 'done' && styles.tlDotDone, step.state === 'current' && styles.tlDotCurrent]}>
                  {step.state === 'done' ? <Check size={11} color={Colors.onPrimary} strokeWidth={3} /> : null}
                </View>
                {idx < r.timeline.length - 1 ? <View style={[styles.tlLine, step.state === 'done' && styles.tlLineDone]} /> : null}
              </View>
              <View style={styles.tlBody}>
                <Text style={[styles.tlLabel, step.state === 'upcoming' && styles.tlMuted]}>{step.label}</Text>
                {step.by ? <Text style={styles.tlBy}>{step.by}</Text> : null}
              </View>
            </View>
          ))}
        </View>

        {/* Vendor */}
        {r.vendor ? (
          <View style={styles.vendorCard}>
            <Image source={{ uri: r.vendor.avatarUrl }} style={styles.vendorAvatar} />
            <View style={styles.vendorInfo}>
              <View style={styles.vendorNameRow}>
                <Text style={styles.vendorName} numberOfLines={1}>{r.vendor.name}</Text>
                <ShieldCheck size={13} color={Colors.tertiaryContainer} strokeWidth={2.4} />
              </View>
              <View style={styles.vendorMeta}>
                <Star size={12} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
                <Text style={styles.vendorMetaText}>{r.vendor.rating.toFixed(1)} · {r.vendor.trade}</Text>
              </View>
            </View>
            <Pressable style={styles.callBtn} accessibilityRole="button" accessibilityLabel="Call vendor"><Phone size={18} color={Colors.secondary} strokeWidth={2} /></Pressable>
          </View>
        ) : null}

        {/* Quote */}
        {r.quoteAmount != null ? (
          <View style={styles.card}>
            <DetailRow label="Vendor quote" value={formatNaira(r.quoteAmount)} emphasis />
            {r.quoteNote ? <Text style={styles.quoteNote}>{r.quoteNote}</Text> : null}
          </View>
        ) : null}

        {/* Completion evidence */}
        {r.completionEvidence.length > 0 ? (
          <>
            <SectionHeader title="Completion evidence" style={styles.sectionFlush} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
              {r.completionEvidence.map((m) => <Image key={m.id} source={{ uri: m.url }} style={styles.photo} />)}
            </ScrollView>
          </>
        ) : null}

        {/* Rate */}
        {r.status === 'tenant_confirmed' || (r.status === 'closed' && r.rating) ? (
          <View style={styles.rateCard}>
            <Text style={styles.rateTitle}>{r.rating ? 'Your rating' : 'Rate this repair'}</Text>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((n) => {
                const filled = (r.rating ?? stars) >= n;
                return (
                  <Pressable key={n} disabled={!!r.rating} onPress={() => setStars(n)} hitSlop={4} accessibilityLabel={`${n} stars`}>
                    <Star size={30} color={Colors.gold} fill={filled ? Colors.gold : 'transparent'} strokeWidth={1.6} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Contextual actions */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {r.status === 'quote_submitted' ? (
          <View style={styles.actionRow}>
            <View style={styles.flex}><PrimaryButton label="Reject" variant="secondary" onPress={() => reject.mutate(r.id)} loading={reject.isPending} /></View>
            <View style={styles.flex}><PrimaryButton label="Approve quote" onPress={() => approve.mutate(r.id)} loading={approve.isPending} /></View>
          </View>
        ) : r.status === 'completed' ? (
          <PrimaryButton label="Confirm completion" onPress={() => confirm.mutate(r.id)} loading={confirm.isPending} />
        ) : r.status === 'tenant_confirmed' ? (
          <PrimaryButton label="Submit rating" onPress={() => rate.mutate({ id: r.id, rating: stars || 5 })} loading={rate.isPending} disabled={stars === 0} />
        ) : null}
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl },
  title: { ...Typography.titleLg, color: Colors.onSurface, marginTop: Spacing.sm },
  badges: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap', marginTop: Spacing.sm },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22, marginTop: Spacing.md },
  photoRow: { gap: Spacing.sm, paddingVertical: Spacing.md },
  photo: { width: 120, height: 90, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  sectionFlush: { paddingHorizontal: 0, marginTop: Spacing.lg },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  tlRow: { flexDirection: 'row', gap: Spacing.md },
  tlRail: { alignItems: 'center', width: 22 },
  tlDot: { width: 22, height: 22, borderRadius: Radius.full, borderWidth: 2, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  tlDotDone: { backgroundColor: Colors.tertiaryContainer, borderColor: Colors.tertiaryContainer },
  tlDotCurrent: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  tlLine: { flex: 1, width: 2, backgroundColor: Colors.outlineVariant, marginVertical: 2 },
  tlLineDone: { backgroundColor: Colors.tertiaryContainer },
  tlBody: { flex: 1, paddingBottom: Spacing.md },
  tlLabel: { ...Typography.labelMd, color: Colors.onSurface },
  tlMuted: { color: Colors.onSurfaceVariant, fontWeight: '400' as const },
  tlBy: { ...Typography.caption, color: Colors.onSurfaceVariant, textTransform: 'capitalize' },
  vendorCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, marginTop: Spacing.md, ...shadow1 },
  vendorAvatar: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  vendorInfo: { flex: 1, gap: 2 },
  vendorNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  vendorName: { ...Typography.titleMd, color: Colors.onSurface },
  vendorMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  vendorMetaText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  callBtn: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  quoteNote: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm, lineHeight: 18 },
  rateCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md, alignItems: 'center', gap: Spacing.sm },
  rateTitle: { ...Typography.labelLg, color: Colors.onSurface },
  stars: { flexDirection: 'row', gap: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest },
  actionRow: { flexDirection: 'row', gap: Spacing.md },
  flex: { flex: 1 },
});
