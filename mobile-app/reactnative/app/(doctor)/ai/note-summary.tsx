import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Sparkles, RefreshCw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { AiPanel, SoapSection, SectionCard, StateView } from '@/features/doctor/components';
import { useAiNoteSummary, useGenerateAiNoteSummary, useAcceptAiNoteSummary } from '@/features/doctor/hooks';
import type { AiNoteSummaryOutput } from '@/types/doctor.phase3';

export default function AiNoteSummaryScreen() {
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const apptId = appointmentId ? String(appointmentId) : '';

  const { data: envelope, isLoading } = useAiNoteSummary(apptId);
  const generate = useGenerateAiNoteSummary();
  const accept = useAcceptAiNoteSummary();

  const [draft, setDraft] = useState<AiNoteSummaryOutput | null>(null);
  const [edited, setEdited] = useState(false);

  // Hydrate the editable draft from the ready envelope (query or generate result).
  useEffect(() => {
    if (envelope?.status === 'ready' && envelope.output && !draft) {
      setDraft(envelope.output);
    }
  }, [envelope, draft]);

  const generating = generate.isPending;
  const error = generate.isError;
  const ready = !!draft && !generating && !error;
  const model = envelope?.model ?? 'Spotlight Care AI';
  const disclaimer = envelope?.disclaimer ?? 'AI-generated draft for clinician review. Not a substitute for professional medical judgement.';

  const runGenerate = async () => {
    try {
      const result = await generate.mutateAsync({ appointmentId: apptId });
      if (result.output) { setDraft(result.output); setEdited(false); }
    } catch {
      // error state handled via generate.isError
    }
  };

  const setField = (patch: Partial<AiNoteSummaryOutput>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setEdited(true);
  };

  const handleAccept = async () => {
    if (!draft) return;
    try {
      await accept.mutateAsync({ appointmentId: apptId, output: draft, edited });
      Alert.alert('Draft accepted', 'The summary has been saved to the consultation notes.', [{ text: 'Done', onPress: () => router.back() }]);
    } catch {
      Alert.alert('Failed', 'Could not save the draft. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="AI Note Summary" />

      {isLoading && !envelope ? (
        <StateView variant="loading" label="Loading" />
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {error ? (
              <AiPanel model={model} disclaimer={disclaimer}>
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>Generation failed</Text>
                  <Text style={styles.errorMsg}>{generate.error instanceof Error ? generate.error.message : 'The AI could not generate a summary.'}</Text>
                  <PrimaryButton label="Retry" onPress={runGenerate} variant="secondary" fullWidth={false} style={styles.retryBtn} />
                </View>
              </AiPanel>
            ) : generating ? (
              <AiPanel model={model} disclaimer={disclaimer} generating />
            ) : ready && draft ? (
              <>
                <AiPanel model={model} disclaimer={disclaimer} confidence={envelope?.confidence} generatedAt={envelope?.generatedAt}>
                  {draft.keyPoints.length > 0 && (
                    <View style={styles.keyPoints}>
                      {draft.keyPoints.map((k) => (
                        <View key={k} style={styles.keyChip}><Text style={styles.keyText}>{k}</Text></View>
                      ))}
                    </View>
                  )}
                </AiPanel>

                <Text style={styles.editHint}>Review and edit the draft before accepting.</Text>
                <SoapSection label="Subjective" value={draft.subjective} onChangeText={(v) => setField({ subjective: v })} />
                <SoapSection label="Objective" value={draft.objective} onChangeText={(v) => setField({ objective: v })} />
                <SoapSection label="Assessment" value={draft.assessment} onChangeText={(v) => setField({ assessment: v })} />
                <SoapSection label="Plan" value={draft.plan} onChangeText={(v) => setField({ plan: v })} />

                {draft.diagnosis.length > 0 && (
                  <SectionCard title="Suggested diagnosis" style={styles.card}>
                    <View style={styles.dxWrap}>
                      {draft.diagnosis.map((d) => (
                        <View key={d} style={styles.dxTag}><Text style={styles.dxText}>{d}</Text></View>
                      ))}
                    </View>
                  </SectionCard>
                )}

                <View style={styles.actions}>
                  <Pressable style={styles.regenBtn} onPress={runGenerate} accessibilityRole="button" accessibilityLabel="Regenerate summary">
                    <RefreshCw size={18} color={Colors.primary} strokeWidth={2} />
                    <Text style={styles.regenText}>Regenerate</Text>
                  </Pressable>
                  <View style={styles.acceptWrap}>
                    <PrimaryButton label={edited ? 'Accept edited draft' : 'Accept draft'} onPress={handleAccept} loading={accept.isPending} />
                  </View>
                </View>
              </>
            ) : (
              <>
                <AiPanel model={model} disclaimer={disclaimer}>
                  <View style={styles.idle}>
                    <Sparkles size={32} color={Colors.primary} strokeWidth={1.8} />
                    <Text style={styles.idleTitle}>Generate a SOAP summary</Text>
                    <Text style={styles.idleMsg}>The AI will draft a structured consultation note from this consult for you to review.</Text>
                  </View>
                </AiPanel>
                <PrimaryButton label="Generate summary" onPress={runGenerate} style={styles.btn} />
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  flex:       { flex: 1 },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  idle:       { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  idleTitle:  { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  idleMsg:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  errorBox:   { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  errorTitle: { ...Typography.titleMd, color: Colors.error },
  errorMsg:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  retryBtn:   { marginTop: Spacing.xs },
  keyPoints:  { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },
  keyChip:    { height: 28, paddingHorizontal: 10, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  keyText:    { ...Typography.labelSm, color: Colors.onSurface },
  editHint:   { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  card:       { marginBottom: Spacing.md },
  dxWrap:     { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  dxTag:      { height: 30, paddingHorizontal: 12, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  dxText:     { ...Typography.labelSm, color: Colors.primary, fontWeight: '600' },
  actions:    { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  regenBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 56, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  regenText:  { ...Typography.labelMd, color: Colors.primary },
  acceptWrap: { flex: 1 },
  btn:        { marginTop: Spacing.sm },
});
