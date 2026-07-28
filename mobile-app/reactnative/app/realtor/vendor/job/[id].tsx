import React, { useState } from 'react';
import { View, Text, Image, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, X, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import SectionHeader from '@/components/SectionHeader';
import StatusBadge from '@/features/realtor/components/StatusBadge';
import { useMaintenanceRequest, useSubmitQuote, useStartJob, useCompleteJob } from '@/features/realtor/hooks/useRealtorMaintenance';
import { CATEGORY_LABEL, MAINT_STATUS_META, URGENCY_META } from '@/features/realtor/constants/realtor.maintenance.constants';

export default function VendorJobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const job = useMaintenanceRequest(String(id));
  const submitQuote = useSubmitQuote();
  const startJob = useStartJob();
  const completeJob = useCompleteJob();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  const addEvidence = () => setEvidence((e) => [...e, `https://picsum.photos/seed/ev${e.length}${Date.now() % 1000}/600/450`]);

  if (job.isLoading) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Job" /><StateView kind="loading" /></SafeAreaView>;
  }
  if (!job.data) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Job" /><StateView kind="error" title="Job not found" actionLabel="Back" onAction={() => router.back()} /></SafeAreaView>;
  }

  const r = job.data;
  const meta = MAINT_STATUS_META[r.status];

  const doQuote = async () => {
    const kobo = (Number(amount.replace(/\D/g, '')) || 0) * 100;
    if (kobo <= 0) return setError('Enter a quote amount.');
    setError(undefined);
    await submitQuote.mutateAsync({ requestId: r.id, amount: kobo, note: note.trim() });
  };
  const doComplete = async () => {
    if (evidence.length === 0) return setError('Add at least one completion photo.');
    setError(undefined);
    await completeJob.mutateAsync({ id: r.id, evidenceUris: evidence });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Job detail" rightSlot={<StatusBadge label={meta.label} tone={meta.tone} />} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{r.title}</Text>
        <View style={styles.loc}>
          <MapPin size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.locText}>{r.propertyName} · {r.unitLabel}, {r.area}</Text>
        </View>
        <View style={styles.badges}>
          <StatusBadge label={CATEGORY_LABEL[r.category]} tone="neutral" />
          <StatusBadge label={URGENCY_META[r.urgency].label} tone={URGENCY_META[r.urgency].tone} />
        </View>
        <Text style={styles.desc}>{r.description}</Text>

        {r.media.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
            {r.media.map((m) => <Image key={m.id} source={{ uri: m.url }} style={styles.photo} />)}
          </ScrollView>
        ) : null}

        {/* Stage-specific input */}
        {r.status === 'vendor_assigned' ? (
          <>
            <SectionHeader title="Submit a quote" style={styles.sectionFlush} />
            <TextInputField label="Quote amount (₦)" placeholder="e.g. 35000" keyboardType="number-pad" value={amount} onChangeText={setAmount} />
            <TextInputField label="Note (scope, parts, labour)" placeholder="What the job involves…" value={note} onChangeText={setNote} multiline />
          </>
        ) : null}

        {r.status === 'in_progress' ? (
          <>
            <SectionHeader title="Completion evidence" style={styles.sectionFlush} />
            <View style={styles.mediaRow}>
              {evidence.map((uri) => (
                <View key={uri} style={styles.thumbWrap}>
                  <Image source={{ uri }} style={styles.thumb} />
                  <Pressable style={styles.removeBtn} hitSlop={6} onPress={() => setEvidence((e) => e.filter((x) => x !== uri))}><X size={12} color={Colors.white} strokeWidth={2.5} /></Pressable>
                </View>
              ))}
              {evidence.length < 4 ? (
                <Pressable style={styles.addPhoto} onPress={addEvidence} accessibilityRole="button" accessibilityLabel="Add evidence photo">
                  <Camera size={20} color={Colors.secondary} strokeWidth={2} /><Text style={styles.addText}>Add</Text>
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {r.status === 'vendor_assigned' ? (
          <PrimaryButton label="Submit quote" onPress={doQuote} loading={submitQuote.isPending} />
        ) : r.status === 'quote_submitted' ? (
          <Text style={styles.waiting}>Waiting for the manager to approve your quote…</Text>
        ) : r.status === 'quote_approved' ? (
          <PrimaryButton label="Start repair" onPress={() => startJob.mutate(r.id)} loading={startJob.isPending} />
        ) : r.status === 'in_progress' ? (
          <PrimaryButton label="Mark completed" onPress={doComplete} loading={completeJob.isPending} />
        ) : (
          <Text style={styles.waiting}>No action needed right now.</Text>
        )}
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  locText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  badges: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22, marginTop: Spacing.md },
  photoRow: { gap: Spacing.sm, paddingVertical: Spacing.md },
  photo: { width: 120, height: 90, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  sectionFlush: { paddingHorizontal: 0, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  mediaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  thumbWrap: { position: 'relative' },
  thumb: { width: 72, height: 72, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  removeBtn: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center' },
  addPhoto: { width: 72, height: 72, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 2 },
  addText: { ...Typography.labelSm, color: Colors.secondary },
  error: { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.md },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest },
  waiting: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.md },
});
