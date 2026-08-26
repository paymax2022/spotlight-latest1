import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Check, Circle, FileText, Upload, MessageCircle } from 'lucide-react-native';
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
import { useApplication } from '@/features/realtor/hooks/useRealtor';
import { APPLICATION_STATUS_META, SCHEDULE_LABEL } from '@/features/realtor/constants/realtor.constants';
import { formatNaira } from '@/features/realtor/utils/realtorFormatters';

export default function ApplicationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApplication(String(id));

  if (app.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Application" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }
  if (app.isError || !app.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Application" />
        <StateView kind="error" title="Application not found" actionLabel="Back" onAction={() => goBack('/realtor/application')} />
      </SafeAreaView>
    );
  }

  const a = app.data;
  const meta = APPLICATION_STATUS_META[a.status];
  const needsInfo = a.status === 'more_info_required';
  const approved = a.status === 'approved' || a.status === 'offer_sent';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Application" rightSlot={<StatusBadge label={meta.label} tone={meta.tone} />} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Pressable style={styles.listingCard} onPress={() => router.push(`/realtor/listing/${a.listingId}`)}>
          <Image source={{ uri: a.listingCoverUrl }} style={styles.thumb} />
          <View style={styles.listingInfo}>
            <Text style={styles.listingTitle} numberOfLines={2}>{a.listingTitle}</Text>
            <Text style={styles.listingPrice}>{formatNaira(a.rent)} {SCHEDULE_LABEL[a.rentSchedule]}</Text>
          </View>
        </Pressable>

        {needsInfo && a.reviewNote ? (
          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>The landlord needs more information</Text>
            <Text style={styles.noteText}>{a.reviewNote}</Text>
          </View>
        ) : null}

        {/* Timeline */}
        <SectionHeader title="Progress" style={styles.sectionFlush} />
        <View style={styles.card}>
          {a.timeline.map((step, idx) => (
            <View key={step.key} style={styles.tlRow}>
              <View style={styles.tlRail}>
                <View style={[styles.tlDot, step.state === 'done' && styles.tlDotDone, step.state === 'current' && styles.tlDotCurrent]}>
                  {step.state === 'done' ? <Check size={12} color={Colors.onPrimary} strokeWidth={3} /> : null}
                </View>
                {idx < a.timeline.length - 1 ? <View style={[styles.tlLine, step.state === 'done' && styles.tlLineDone]} /> : null}
              </View>
              <View style={styles.tlBody}>
                <Text style={[styles.tlLabel, step.state === 'upcoming' && styles.tlLabelMuted]}>{step.label}</Text>
                {step.state === 'current' ? <Text style={styles.tlNow}>In progress</Text> : null}
              </View>
            </View>
          ))}
        </View>

        {/* Documents */}
        <SectionHeader title="Documents" style={styles.sectionFlush} />
        <View style={styles.card}>
          {a.documents.map((d) => (
            <View key={d.id} style={styles.docRow}>
              <FileText size={18} color={d.uploaded ? Colors.tertiaryContainer : Colors.outline} strokeWidth={2} />
              <View style={styles.docInfo}>
                <Text style={styles.docLabel}>{d.label}</Text>
                <Text style={styles.docMeta}>{d.required ? 'Required' : 'Optional'}</Text>
              </View>
              {d.uploaded ? (
                <StatusBadge label="Uploaded" tone="success" />
              ) : (
                <Pressable style={styles.uploadBtn} accessibilityRole="button" accessibilityLabel={`Upload ${d.label}`}>
                  <Upload size={14} color={Colors.secondary} strokeWidth={2} />
                  <Text style={styles.uploadText}>Upload</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>

        {/* Move-in summary */}
        <SectionHeader title="Move-in cost" style={styles.sectionFlush} />
        <View style={styles.card}>
          <DetailRow label="Rent" value={`${formatNaira(a.rent)} ${SCHEDULE_LABEL[a.rentSchedule]}`} />
          {a.cautionDeposit ? <DetailRow label="Caution deposit" value={formatNaira(a.cautionDeposit)} refundable /> : null}
        </View>
      </ScrollView>

      {/* Contextual footer */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {approved ? (
          <PrimaryButton label="View lease offer" onPress={() => router.push(`/realtor/lease/lease_${a.id}`)} />
        ) : needsInfo ? (
          <PrimaryButton label="Provide more info" onPress={() => { /* resubmit flow */ }} />
        ) : (
          <Pressable style={styles.contactBtn} accessibilityRole="button" accessibilityLabel="Message agent">
            <MessageCircle size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.contactText}>Message {a.agent.name}</Text>
          </Pressable>
        )}
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl },
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
  thumb: { width: 72, height: 72, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  listingInfo: { flex: 1, justifyContent: 'center', gap: 4 },
  listingTitle: { ...Typography.labelLg, color: Colors.onSurface },
  listingPrice: { ...Typography.titleMd, color: Colors.primary },
  noteCard: { backgroundColor: Colors.iconBgGold, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  noteTitle: { ...Typography.labelLg, color: Colors.onWarning, marginBottom: 4 },
  noteText: { ...Typography.bodySm, color: Colors.onSurface, lineHeight: 20 },
  sectionFlush: { paddingHorizontal: 0, marginTop: Spacing.lg },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
  },
  tlRow: { flexDirection: 'row', gap: Spacing.md },
  tlRail: { alignItems: 'center', width: 24 },
  tlDot: {
    width: 24, height: 24, borderRadius: Radius.full,
    borderWidth: 2, borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
    alignItems: 'center', justifyContent: 'center',
  },
  tlDotDone: { backgroundColor: Colors.tertiaryContainer, borderColor: Colors.tertiaryContainer },
  tlDotCurrent: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  tlLine: { flex: 1, width: 2, backgroundColor: Colors.outlineVariant, marginVertical: 2 },
  tlLineDone: { backgroundColor: Colors.tertiaryContainer },
  tlBody: { flex: 1, paddingBottom: Spacing.lg },
  tlLabel: { ...Typography.labelLg, color: Colors.onSurface },
  tlLabelMuted: { color: Colors.onSurfaceVariant, fontWeight: '400' as const },
  tlNow: { ...Typography.labelSm, color: Colors.primary },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  docInfo: { flex: 1 },
  docLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  docMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  uploadText: { ...Typography.labelMd, color: Colors.secondary },
  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerLow,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  contactBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52 },
  contactText: { ...Typography.labelLg, color: Colors.secondary },
});
