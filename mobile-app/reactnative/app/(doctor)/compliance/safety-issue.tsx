import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SoapSection, SectionCard, StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useSafetyIssues, useReportSafetyIssue } from '@/features/doctor/hooks';
import { SAFETY_ISSUE_CATEGORY_OPTIONS, SAFETY_ISSUE_SEVERITY_OPTIONS } from '@/features/doctor/constants';
import type { SafetyIssueCategory, SafetyIssueSeverity, SafetyIssueStatus } from '@/types/doctor.batch7';

// ── Section AB — Report medical safety issue + list (AB.16) ────────────────────
// NEW screen: a safety-issue report form (category / severity / description) and
// the list of previously reported issues. Reuses SelectField / SoapSection /
// StatusBadge.

const STATUS_TONE: Record<SafetyIssueStatus, StatusTone> = {
  submitted: 'info', acknowledged: 'info', investigating: 'warning', closed: 'success',
};
const STATUS_LABEL: Record<SafetyIssueStatus, string> = {
  submitted: 'Submitted', acknowledged: 'Acknowledged', investigating: 'Investigating', closed: 'Closed',
};

export default function SafetyIssueScreen() {
  const { data: issues = [], isLoading, isError, refetch } = useSafetyIssues();
  const report = useReportSafetyIssue();

  const catLabelToValue = useMemo(() => Object.fromEntries(SAFETY_ISSUE_CATEGORY_OPTIONS.map((o) => [o.label, o.value])) as Record<string, SafetyIssueCategory>, []);
  const sevLabelToValue = useMemo(() => Object.fromEntries(SAFETY_ISSUE_SEVERITY_OPTIONS.map((o) => [o.label, o.value])) as Record<string, SafetyIssueSeverity>, []);

  const [category, setCategory] = useState<SafetyIssueCategory>();
  const [severity, setSeverity] = useState<SafetyIssueSeverity>();
  const [description, setDescription] = useState('');

  const labelOf = <T extends string>(opts: { value: T; label: string }[], v?: T) => opts.find((o) => o.value === v)?.label;
  const canSubmit = !!category && !!severity && description.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || !category || !severity) {
      Alert.alert('Incomplete', 'Choose a category, severity and add a description.');
      return;
    }
    try {
      const result = await report.mutateAsync({ category, severity, description: description.trim() });
      Alert.alert('Reported', `${result.ref} has been submitted to the safety team.`);
      setCategory(undefined);
      setSeverity(undefined);
      setDescription('');
    } catch {
      Alert.alert('Failed', 'Could not submit the report. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Safety Issue" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <SectionCard title="Report a safety issue" style={styles.card}>
            <SelectField label="Category" placeholder="Select a category" value={labelOf(SAFETY_ISSUE_CATEGORY_OPTIONS, category)} options={SAFETY_ISSUE_CATEGORY_OPTIONS.map((o) => o.label)} onChange={(l) => setCategory(catLabelToValue[l])} />
            <SelectField label="Severity" placeholder="Select severity" value={labelOf(SAFETY_ISSUE_SEVERITY_OPTIONS, severity)} options={SAFETY_ISSUE_SEVERITY_OPTIONS.map((o) => o.label)} onChange={(l) => setSeverity(sevLabelToValue[l])} />
            <SoapSection label="Description" value={description} onChangeText={setDescription} placeholder="Describe the safety issue…" />
            <PrimaryButton label="Submit report" onPress={handleSubmit} loading={report.isPending} disabled={!canSubmit} />
          </SectionCard>

          <Text style={styles.groupTitle}>Reported issues</Text>
          {isLoading && issues.length === 0 ? (
            <StateView variant="loading" label="Loading reports" />
          ) : isError ? (
            <StateView variant="error" message="We could not load your reports." onRetry={() => refetch()} />
          ) : issues.length === 0 ? (
            <StateView variant="empty" icon={ShieldAlert} title="No reports yet" message="Safety issues you report will appear here." />
          ) : (
            <View style={styles.list}>
              {issues.map((iss) => (
                <View key={iss.id} style={styles.issue}>
                  <View style={styles.issueTop}>
                    <Text style={styles.issueRef}>{iss.ref}</Text>
                    <StatusBadge label={STATUS_LABEL[iss.status]} tone={STATUS_TONE[iss.status]} />
                  </View>
                  <Text style={styles.issueDesc} numberOfLines={2}>{iss.description}</Text>
                  <Text style={styles.issueMeta}>{new Date(iss.reportedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  flex:       { flex: 1 },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:       { marginBottom: Spacing.md },
  groupTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  list:       { gap: Spacing.sm },
  issue:      { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: 4 },
  issueTop:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  issueRef:   { ...Typography.labelLg, color: Colors.onSurface },
  issueDesc:  { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  issueMeta:  { ...Typography.caption, color: Colors.onSurfaceVariant },
});
