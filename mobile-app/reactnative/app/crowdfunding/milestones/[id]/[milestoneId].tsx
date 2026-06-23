import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { FileUp, Plus, X, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useCampaign } from '@/features/crowdfunding/hooks/useCrowdfunding';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import { pickDocument, type PickedDocument } from '@/features/crowdfunding/utils/mediaPicker';

export default function MilestoneDetailScreen() {
  const { id, milestoneId } = useLocalSearchParams<{ id: string; milestoneId: string }>();
  const { data: c, isLoading, isError, refetch } = useCampaign(id);
  const m = c?.milestones.find((x) => x.id === milestoneId);

  const [evidence, setEvidence] = useState<PickedDocument[]>([]);
  const [requested, setRequested] = useState(false);

  const addEvidence = async () => {
    const doc = await pickDocument();
    if (doc) setEvidence((prev) => [...prev, doc]);
  };

  if (isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Milestone" /><StateView kind="loading" /></SafeAreaView>;
  if (isError || !c || !m) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Milestone" /><StateView kind="error" title="Milestone not found" actionLabel="Retry" onAction={refetch} /></SafeAreaView>;

  if (requested) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Disbursement requested" showBack={false} />
        <StateView kind="empty" icon="FileSearch" title="Submitted for review" message="Our team will review your evidence and release the milestone funds once verified. You'll be notified of the outcome." actionLabel="Back to milestones" onAction={() => router.dismissTo(`/crowdfunding/milestones/${id}`)} />
      </SafeAreaView>
    );
  }

  const canRequest = m.status === 'ACTIVE';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={m.title} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.targetCard}>
          <Text style={styles.targetLabel}>Releases at</Text>
          <Text style={styles.targetValue}>{formatNaira(m.targetKobo)}</Text>
          <Text style={styles.targetSub}>Status: {m.status.replace('_', ' ').toLowerCase()}</Text>
        </View>

        <View style={styles.banner}>
          <ShieldCheck size={16} color={Colors.tertiaryContainer} strokeWidth={2} />
          <Text style={styles.bannerText}>Upload receipts or photos proving how this milestone's funds were (or will be) used. Admin verifies before release.</Text>
        </View>

        <Text style={styles.label}>Evidence</Text>
        {evidence.map((e, i) => (
          <View key={i} style={styles.docRow}>
            <View style={styles.docIcon}><FileUp size={16} color={Colors.secondary} strokeWidth={2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.docName} numberOfLines={1}>{e.name}</Text>
              <Text style={styles.docMeta}>{e.sizeLabel}</Text>
            </View>
            <Pressable onPress={() => setEvidence(evidence.filter((_, idx) => idx !== i))} hitSlop={8} accessibilityLabel="Remove"><X size={16} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
        ))}
        {canRequest && (
          <Pressable style={styles.addEvidence} onPress={addEvidence} accessibilityRole="button" accessibilityLabel="Add evidence file">
            <Plus size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.addEvidenceText}>Add receipt or photo</Text>
          </Pressable>
        )}
        {m.evidenceCount > 0 && <Text style={styles.existing}>{m.evidenceCount} file(s) already on record.</Text>}
      </ScrollView>

      {canRequest && (
        <View style={styles.footer}>
          <PrimaryButton label="Request disbursement" onPress={() => setRequested(true)} disabled={evidence.length === 0} />
          {evidence.length === 0 && <Text style={styles.hint}>Add at least one evidence file to request release.</Text>}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  targetCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.lg, alignItems: 'center', marginBottom: Spacing.md },
  targetLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  targetValue: { ...Typography.headlineMd, color: Colors.onSurface },
  targetSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  banner: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  bannerText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.sm },
  docIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  docName: { ...Typography.labelMd, color: Colors.onSurface },
  docMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  addEvidence: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderStyle: 'dashed', backgroundColor: Colors.surfaceContainerLow },
  addEvidenceText: { ...Typography.labelMd, color: Colors.primary },
  existing: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, gap: 4 },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
