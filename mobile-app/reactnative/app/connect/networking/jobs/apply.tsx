import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { FileText, Check, Link2, Upload } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useMyResumes, useApplyToJob } from '@/features/connect/networking/jobs/hooks';
import type { ResumeRef } from '@/features/connect/networking/jobs/types';

/**
 * Apply flow (PRD §6.1 JB-03). Pick a resume, optionally attach a portfolio
 * link, add a cover note, then submit. The apply mutation carries an
 * Idempotency-Key (see api.applyToJob).
 */
export default function JobApplyScreen() {
  const { id, title, company } = useLocalSearchParams<{ id: string; title: string; company: string }>();
  const jobId = String(id ?? '');
  const jobTitle = String(title ?? 'this role');
  const companyName = String(company ?? '');

  const resumesQuery = useMyResumes();
  const resumes = resumesQuery.data ?? [];

  const [resumeId, setResumeId] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState('');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);

  const apply = useApplyToJob();

  const selectedResume = resumes.find((r) => r.id === resumeId);
  const canSubmit = !!jobId && !!selectedResume;

  function onSubmit() {
    if (!selectedResume) return;
    apply.mutate(
      {
        jobId,
        resumeRef: selectedResume.label,
        portfolioUrl: portfolio.trim() || undefined,
        coverNote: note.trim() || undefined,
      },
      {
        onSuccess: () => {
          setSent(true);
          setTimeout(() => router.replace('/connect/networking/jobs/my-applications'), 1200);
        },
      },
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Apply" subtitle={companyName || jobTitle} />

      {sent ? (
        <StateView
          kind="empty"
          icon="CircleCheck"
          title="Application sent"
          message={`Your application for ${jobTitle} is in. Track its status under My applications.`}
        />
      ) : (
        <>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.roleTitle}>{jobTitle}</Text>
            {companyName ? <Text style={styles.roleCompany}>{companyName}</Text> : null}

            {/* Resume picker */}
            <Text style={styles.sectionTitle}>Resume / CV</Text>
            {resumesQuery.isLoading ? (
              <StateView kind="loading" compact message="Loading your resumes…" />
            ) : (
              <View style={styles.resumeList}>
                {resumes.map((r) => (
                  <ResumeRow
                    key={r.id}
                    resume={r}
                    selected={r.id === resumeId}
                    onPress={() => setResumeId(r.id)}
                  />
                ))}
                <Pressable style={styles.uploadRow} accessibilityRole="button" onPress={() => { /* mock: no picker */ }}>
                  <Upload size={18} color={ConnectColors.brand} strokeWidth={2} />
                  <Text style={styles.uploadText}>Upload a new resume</Text>
                </Pressable>
              </View>
            )}

            {/* Portfolio link */}
            <Text style={styles.sectionTitle}>Portfolio or website (optional)</Text>
            <TextInputField
              value={portfolio}
              onChangeText={setPortfolio}
              placeholder="https://…"
              autoCapitalize="none"
              keyboardType="url"
              leftIcon={<Link2 size={18} color={Colors.outline} strokeWidth={2} />}
            />

            {/* Cover note */}
            <Text style={styles.sectionTitle}>Cover note (optional)</Text>
            <TextInputField
              value={note}
              onChangeText={setNote}
              placeholder="Tell them why you’re a great fit…"
              multiline
              numberOfLines={5}
              maxLength={600}
              style={styles.noteInput}
            />

            {apply.isError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>Couldn’t submit your application. Please try again.</Text>
              </View>
            ) : null}

            <View style={{ height: Spacing.xl }} />
          </ScrollView>

          <View style={styles.footer}>
            {!selectedResume ? (
              <Text style={styles.hint}>Select a resume to continue.</Text>
            ) : null}
            <PrimaryButton
              label="Submit application"
              onPress={onSubmit}
              loading={apply.isPending}
              disabled={!canSubmit}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function ResumeRow({
  resume,
  selected,
  onPress,
}: {
  resume: ResumeRef;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.resumeRow, selected && styles.resumeRowSelected]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <View style={styles.resumeIcon}>
        <FileText size={18} color={ConnectColors.brand} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.resumeLabel} numberOfLines={1}>{resume.label}</Text>
        <Text style={styles.resumeMeta}>Updated {new Date(resume.updatedAt).toLocaleDateString('en-NG')}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected ? <Check size={13} color={Colors.onPrimary} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  roleTitle: { ...Typography.titleLg, color: Colors.onSurface },
  roleCompany: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: 2 },
  sectionTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700', marginTop: Spacing.lg, marginBottom: Spacing.sm },
  resumeList: { gap: Spacing.sm },
  resumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
  },
  resumeRowSelected: { borderColor: ConnectColors.brand, backgroundColor: Colors.iconBgPurple },
  resumeIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  resumeLabel: { ...Typography.labelLg, color: Colors.onSurface },
  resumeMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: ConnectColors.brand, borderColor: ConnectColors.brand },
  uploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  uploadText: { ...Typography.labelMd, color: ConnectColors.brand, fontWeight: '700' },
  noteInput: { minHeight: 120, textAlignVertical: 'top' },
  errorBox: {
    backgroundColor: Colors.errorContainer,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  errorText: { ...Typography.labelMd, color: Colors.error },
  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
    gap: Spacing.xs,
  },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
