import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { VisitorColors } from '../constants/visitor.constants';
import { useGateSession, useSubmitIncident } from '../hooks/useVisitor';
import type { IncidentKind, IncidentSeverity } from '../types/visitor.types';

const SEVERITIES: { key: IncidentSeverity; label: string; color: string; bg: string }[] = [
  { key: 'low', label: 'Low', color: VisitorColors.success, bg: VisitorColors.successBg },
  { key: 'medium', label: 'Medium', color: VisitorColors.warning, bg: VisitorColors.warningBg },
  { key: 'high', label: 'High', color: Colors.error, bg: Colors.errorContainer },
];

/** Shared report form for suspicious-visitor alerts and incident reports. */
export default function IncidentReportForm({ kind }: { kind: IncidentKind }) {
  const session = useGateSession();
  const submit = useSubmitIncident();

  const [severity, setSeverity] = useState<IncidentSeverity>('medium');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [escalate, setEscalate] = useState(kind === 'suspicious');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const heading = kind === 'suspicious' ? 'Suspicious activity' : 'Incident report';
  const gateId = session.data?.gateId ?? 'gate_main';

  const onSubmit = () => {
    setError('');
    if (!title.trim() || !description.trim()) { setError('Add a short title and a description.'); return; }
    submit.mutate(
      { kind, severity, title: title.trim(), description: description.trim(), gateId, escalate },
      { onSuccess: () => setDone(true), onError: (e) => setError(e instanceof Error ? e.message : 'Could not submit.') },
    );
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={heading} showBack={false} />
        <View style={styles.resultWrap}>
          <View style={[styles.bigIcon, { backgroundColor: VisitorColors.successBg }]}>
            <CircleCheck size={44} color={Colors.teal} strokeWidth={1.6} />
          </View>
          <Text style={styles.resultTitle}>{escalate ? 'Reported & escalated' : 'Report logged'}</Text>
          <Text style={styles.resultBody}>{escalate ? 'Estate admin and security have been notified.' : 'Your report has been recorded for this shift.'}</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Done" onPress={() => router.replace('/guard')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={heading} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>Severity</Text>
          <View style={styles.sevRow}>
            {SEVERITIES.map((s) => {
              const selected = s.key === severity;
              return (
                <Pressable key={s.key} onPress={() => setSeverity(s.key)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.sev, { backgroundColor: selected ? s.color : s.bg }]}>
                  <Text style={[styles.sevText, { color: selected ? Colors.onPrimary : s.color }]}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInputField label="Title" placeholder={kind === 'suspicious' ? 'e.g. Loitering near Gate B' : 'e.g. Barrier damaged'} value={title} onChangeText={setTitle} />
          <TextInputField label="Description" placeholder="What did you observe?" value={description} onChangeText={setDescription} multiline numberOfLines={5} style={styles.descInput} />

          <Pressable onPress={() => setEscalate((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: escalate }} style={styles.escRow}>
            <View style={[styles.checkbox, escalate && styles.checkboxOn]}>{escalate ? <CircleCheck size={16} color={Colors.onPrimary} /> : null}</View>
            <View style={{ flex: 1 }}>
              <Text style={styles.escTitle}>Escalate to admin & security</Text>
              <Text style={styles.escSub}>Send an immediate alert in addition to logging.</Text>
            </View>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label={escalate ? 'Submit & escalate' : 'Submit report'} onPress={onSubmit} loading={submit.isPending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  sevRow: { flexDirection: 'row', gap: Spacing.sm },
  sev: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.md, minHeight: 44, justifyContent: 'center' },
  sevText: { ...Typography.labelMd },
  descInput: { minHeight: 110, textAlignVertical: 'top', paddingTop: Spacing.sm },
  escRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  checkbox: { width: 26, height: 26, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  escTitle: { ...Typography.labelMd, color: Colors.onSurface },
  escSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  error: { ...Typography.labelMd, color: Colors.error },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
  resultWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  bigIcon: { width: 92, height: 92, borderRadius: Radius.xxl, alignItems: 'center', justifyContent: 'center' },
  resultTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  resultBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
