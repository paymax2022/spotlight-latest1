import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { ArrowDown, ArrowUp, Minus, Sparkles, ListChecks } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { AiPanel, SectionCard, StateView } from '@/features/doctor/components';
import { useAiLabExplanation, useExplainLabResult } from '@/features/doctor/hooks';
import type { AiLabFlagExplanation } from '@/types/doctor.phase3';

const FLAG_CONFIG: Record<AiLabFlagExplanation['flag'], { icon: LucideIcon; color: string; bg: string; label: string }> = {
  normal: { icon: Minus,    color: Colors.teal,      bg: Colors.iconBgTeal, label: 'Normal' },
  low:    { icon: ArrowDown, color: Colors.secondary, bg: Colors.iconBgBlue, label: 'Low' },
  high:   { icon: ArrowUp,   color: Colors.error,     bg: Colors.iconBgRed,  label: 'High' },
};

export default function AiLabExplanationScreen() {
  const { resultId } = useLocalSearchParams<{ resultId?: string }>();
  const rid = resultId ? String(resultId) : '';

  const { data: cached, isLoading } = useAiLabExplanation(rid);
  const explain = useExplainLabResult();

  // Prefer the freshly-generated envelope; fall back to the cached read.
  const envelope = explain.data ?? cached;
  const generating = explain.isPending;
  const error = explain.isError;
  const ready = !!envelope && envelope.status === 'ready' && !generating && !error;

  const model = envelope?.model ?? 'Spotlight Care AI';
  const disclaimer = envelope?.disclaimer ?? 'AI-generated explanation for clinician review. Not a substitute for professional medical judgement.';

  const runExplain = () => { if (rid) explain.mutate({ resultId: rid }); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="AI Lab Explanation" />

      {isLoading && !envelope ? (
        <StateView variant="loading" label="Loading" />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {error ? (
            <AiPanel model={model} disclaimer={disclaimer}>
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>Explanation failed</Text>
                <Text style={styles.errorMsg}>{explain.error instanceof Error ? explain.error.message : 'The AI could not explain this result.'}</Text>
                <PrimaryButton label="Retry" onPress={runExplain} variant="secondary" fullWidth={false} style={styles.retryBtn} />
              </View>
            </AiPanel>
          ) : generating ? (
            <AiPanel model={model} disclaimer={disclaimer} generating />
          ) : ready && envelope.output ? (
            <>
              <AiPanel model={model} disclaimer={disclaimer} confidence={envelope.confidence} generatedAt={envelope.generatedAt}>
                <Text style={styles.headline}>{envelope.output.headline}</Text>
                <Text style={styles.summary}>{envelope.output.plainSummary}</Text>
              </AiPanel>

              {envelope.output.flags.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Abnormal values explained</Text>
                  {envelope.output.flags.map((f) => {
                    const cfg = FLAG_CONFIG[f.flag];
                    const Icon = cfg.icon;
                    return (
                      <View key={f.testName} style={styles.flagCard}>
                        <View style={styles.flagHead}>
                          <Text style={styles.flagName}>{f.testName}</Text>
                          <View style={[styles.flagPill, { backgroundColor: cfg.bg }]}>
                            <Icon size={11} color={cfg.color} strokeWidth={2.5} />
                            <Text style={[styles.flagPillText, { color: cfg.color }]}>{cfg.label}</Text>
                          </View>
                        </View>
                        <Text style={styles.flagMeaning}>{f.meaning}</Text>
                        {f.possibleCauses.length > 0 && (
                          <View style={styles.causes}>
                            {f.possibleCauses.map((c) => (
                              <View key={c} style={styles.causeChip}><Text style={styles.causeText}>{c}</Text></View>
                            ))}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </>
              )}

              {envelope.output.followUps.length > 0 && (
                <SectionCard title="Suggested follow-ups" style={styles.card}>
                  {envelope.output.followUps.map((s, i) => (
                    <View key={s} style={[styles.followRow, i > 0 && styles.rowBorder]}>
                      <ListChecks size={16} color={Colors.primary} strokeWidth={2} />
                      <Text style={styles.followText}>{s}</Text>
                    </View>
                  ))}
                </SectionCard>
              )}

              <PrimaryButton label="Regenerate" onPress={runExplain} variant="secondary" style={styles.btn} />
            </>
          ) : (
            <>
              <AiPanel model={model} disclaimer={disclaimer}>
                <View style={styles.idle}>
                  <Sparkles size={32} color={Colors.primary} strokeWidth={1.8} />
                  <Text style={styles.idleTitle}>Explain this lab result</Text>
                  <Text style={styles.idleMsg}>The AI will translate the values into plain language and interpret any abnormal flags.</Text>
                </View>
              </AiPanel>
              <PrimaryButton label="Explain with AI" onPress={runExplain} style={styles.btn} />
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  content:       { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  idle:          { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  idleTitle:     { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  idleMsg:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  errorBox:      { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  errorTitle:    { ...Typography.titleMd, color: Colors.error },
  errorMsg:      { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  retryBtn:      { marginTop: Spacing.xs },
  headline:      { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  summary:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  sectionTitle:  { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  flagCard:      { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.xs, marginBottom: Spacing.sm },
  flagHead:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  flagName:      { ...Typography.labelLg, color: Colors.onSurface },
  flagPill:      { flexDirection: 'row', alignItems: 'center', gap: 3, height: 22, paddingHorizontal: 8, borderRadius: Radius.full },
  flagPillText:  { ...Typography.labelSm, fontWeight: '700' },
  flagMeaning:   { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  causes:        { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },
  causeChip:     { height: 26, paddingHorizontal: 10, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  causeText:     { ...Typography.labelSm, color: Colors.onSurface },
  card:          { marginBottom: Spacing.md, marginTop: Spacing.xs },
  followRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  followText:    { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  rowBorder:     { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  btn:           { marginTop: Spacing.sm },
});
