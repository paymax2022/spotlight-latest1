import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Flag, CircleCheck, ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useStreamReportReasons, useReportStream } from '@/features/connect/live/hooks';

/**
 * Report a stream (PRD §10.6 LV-13). SAFETY §7: a report ALWAYS creates a case;
 * it must never fail silently — the caseId is shown to the user.
 */
export default function ReportStreamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const reasonsQ = useStreamReportReasons();
  const report = useReportStream();
  const [code, setCode] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [caseId, setCaseId] = useState<string | null>(null);

  function submit() {
    if (!code) return;
    report.mutate(
      { streamId: id ?? '', reasonCode: code, details: details.trim() || undefined },
      { onSuccess: (r) => setCaseId(r.caseId) },
    );
  }

  if (caseId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScreenHeader title="Report received" showBack={false} />
        <View style={styles.successWrap}>
          <View style={styles.successIcon}><CircleCheck size={40} color={ConnectColors.ok} strokeWidth={2} /></View>
          <Text style={styles.successTitle}>Thank you — case opened</Text>
          <Text style={styles.caseId}>Case {caseId}</Text>
          <Text style={styles.successBody}>Our safety team will review this stream. You can track the outcome in your safety cases. The host won't know who reported them.</Text>
          <View style={{ width: '100%', marginTop: Spacing.lg }}><PrimaryButton label="Done" onPress={() => goBack('/connect')} /></View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Report stream" />
      {reasonsQ.isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : reasonsQ.isError ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => reasonsQ.refetch()} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.banner}>
              <ShieldAlert size={16} color={Colors.error} strokeWidth={2.2} />
              <Text style={styles.bannerText}>If someone is asking you to send money off-platform, gift cards or crypto, report it as a scam — never pay.</Text>
            </View>
            <Text style={styles.label}>Why are you reporting this?</Text>
            {(reasonsQ.data ?? []).map((r) => {
              const active = code === r.code;
              return (
                <Pressable key={r.code} style={[styles.option, active && styles.optionActive]} onPress={() => setCode(r.code)} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                  <View style={[styles.radio, active && styles.radioActive]}>{active ? <View style={styles.radioDot} /> : null}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionLabel}>{r.label}</Text>
                    {r.description ? <Text style={styles.optionDesc}>{r.description}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
            <Text style={[styles.label, { marginTop: Spacing.md }]}>Add details (optional)</Text>
            <TextInput
              value={details}
              onChangeText={setDetails}
              placeholder="What happened?"
              placeholderTextColor={Colors.onSurfaceVariant}
              style={styles.input}
              multiline
            />
          </ScrollView>
          <View style={styles.footer}>
            <PrimaryButton label={report.isPending ? 'Submitting…' : 'Submit report'} onPress={submit} disabled={!code || report.isPending} loading={report.isPending} variant="danger" />
            {report.isError ? <Text style={styles.errText}>Couldn't submit. Please try again — your report matters.</Text> : null}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.sm },
  banner: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.errorContainer, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  bannerText: { ...Typography.caption, color: Colors.error, flex: 1, lineHeight: 17 },
  label: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: 4 },
  option: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md, borderWidth: 1.5, borderColor: ConnectColors.border, padding: Spacing.md },
  optionActive: { borderColor: ConnectColors.brand, backgroundColor: Colors.iconBgPurple },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioActive: { borderColor: ConnectColors.brand },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ConnectColors.brand },
  optionLabel: { ...Typography.labelLg, color: Colors.onSurface },
  optionDesc: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  input: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md, borderWidth: 1.5, borderColor: ConnectColors.border, padding: Spacing.md, minHeight: 90, textAlignVertical: 'top', ...Typography.bodyMd, color: Colors.onSurface },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: ConnectColors.border, gap: Spacing.sm },
  errText: { ...Typography.labelSm, color: Colors.error, textAlign: 'center' },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: ConnectColors.okBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  successTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  caseId: { ...Typography.titleMd, color: ConnectColors.brand, marginTop: 4 },
  successBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.xs },
});
