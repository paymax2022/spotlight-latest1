// ── Film Academy — assignments ───────────────────────────────────────────────
// A NATIVE screen. Brief, submission, and the tutor's grade in one place, so a
// learner never has to remember what they sent.
//
// A graded assignment is read-only here AND on the server: resubmitting would
// erase the tutor's score and feedback, so the form is not offered at all.

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  TextInput, RefreshControl, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, CircleCheck, Clock, Lock, Award, ExternalLink } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import {
  getAssignments,
  submitAssignment,
  FILM_ACADEMY_ASSIGNMENTS_KEY,
} from '@/features/filmAcademy/api';
import { lockCopy } from '@/features/filmAcademy/lockCopy';
import { getErrorMessage } from '@/utils/errorMapper';
import type { FilmAcademyAssignment } from '@/features/filmAcademy/types';

function formatDate(iso: string | null): string {
  if (!iso) return 'No deadline';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'No deadline';
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function AssignmentCard({ assignment }: { assignment: FilmAcademyAssignment }) {
  const queryClient = useQueryClient();
  const submission = assignment.submission;
  const graded = submission?.status === 'graded';

  const [link, setLink] = useState(submission?.submission_link ?? '');
  const [text, setText] = useState(submission?.submission_text ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!submission);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitAssignment({
        assignmentId: assignment.id,
        submissionLink: link.trim() || undefined,
        submissionText: text.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_ASSIGNMENTS_KEY });
      setOpen(false);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{assignment.title}</Text>
        {graded ? (
          <View style={styles.gradedPill}>
            <Award size={12} color={Colors.teal} />
            <Text style={styles.gradedText}>
              {submission!.score}
              {assignment.max_score ? `/${assignment.max_score}` : ''}
            </Text>
          </View>
        ) : submission ? (
          <View style={styles.submittedPill}>
            <CircleCheck size={12} color={Colors.gold} />
            <Text style={styles.submittedText}>Submitted</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.metaRow}>
        <Clock size={12} color={Colors.onSurfaceVariant} />
        <Text style={styles.meta}>Due {formatDate(assignment.due_date)}</Text>
      </View>

      {!!assignment.description && <Text style={styles.body}>{assignment.description}</Text>}
      {!!assignment.rubric && (
        <Text style={styles.rubric}>How it is marked: {assignment.rubric}</Text>
      )}

      {graded && (
        <View style={styles.feedbackBox}>
          <Text style={styles.feedbackLabel}>Tutor feedback</Text>
          <Text style={styles.feedbackText}>
            {submission!.feedback || 'No written feedback was left.'}
          </Text>
        </View>
      )}

      {!!submission?.submission_link && (
        <Pressable
          onPress={() => void Linking.openURL(submission.submission_link!).catch(() => {})}
          style={styles.linkRow}
        >
          <ExternalLink size={14} color={Colors.gold} />
          <Text style={styles.linkText} numberOfLines={1}>{submission.submission_link}</Text>
        </Pressable>
      )}

      {graded ? (
        <Text style={styles.meta}>This assignment has been graded and is now closed.</Text>
      ) : open ? (
        <View style={styles.form}>
          <Text style={styles.fieldLabel}>Link to your work</Text>
          <TextInput
            value={link}
            onChangeText={setLink}
            placeholder="https://…"
            placeholderTextColor={Colors.onSurfaceVariant}
            autoCapitalize="none"
            keyboardType="url"
            style={styles.input}
          />
          <Text style={styles.fieldLabel}>Or write your submission</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Type your answer…"
            placeholderTextColor={Colors.onSurfaceVariant}
            multiline
            style={[styles.input, styles.inputMultiline]}
          />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            onPress={send}
            disabled={busy || (!link.trim() && !text.trim())}
            style={[styles.sendBtn, (busy || (!link.trim() && !text.trim())) && styles.sendBtnDisabled]}
          >
            {busy
              ? <ActivityIndicator color={Colors.black} />
              : <Text style={styles.sendBtnText}>{submission ? 'Resubmit' : 'Submit'}</Text>}
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setOpen(true)} style={styles.editBtn}>
          <Text style={styles.editBtnText}>Change my submission</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function FilmAcademyAssignmentsScreen() {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: FILM_ACADEMY_ASSIGNMENTS_KEY,
    queryFn: getAssignments,
  });

  const lock = lockCopy(data?.reason);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/film-academy')} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Assignments</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
      >
        {isLoading && (
          <View style={styles.state}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.stateText}>Loading your assignments…</Text>
          </View>
        )}

        {!!error && !isLoading && (
          <View style={styles.state}>
            <Text style={styles.stateText}>Could not load your assignments.</Text>
            <Pressable onPress={() => refetch()} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {!isLoading && !error && data?.locked && (
          <View style={styles.state}>
            <Lock size={28} color={Colors.onSurfaceVariant} />
            <Text style={styles.lockTitle}>{lock.title}</Text>
            <Text style={styles.stateText}>{lock.detail}</Text>
            {!!lock.cta && (
              <Pressable onPress={() => router.push(lock.cta!.route as never)} style={styles.retry}>
                <Text style={styles.retryText}>{lock.cta.label}</Text>
              </Pressable>
            )}
          </View>
        )}

        {!isLoading && !error && !data?.locked && data!.assignments.length === 0 && (
          <View style={styles.state}>
            <Text style={styles.stateText}>
              No assignments have been set yet. They will appear here when your tutors publish them.
            </Text>
          </View>
        )}

        {!isLoading && !error && !data?.locked &&
          data!.assignments.map((a) => <AssignmentCard key={a.id} assignment={a} />)}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  back:        { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  scroll:      { padding: Spacing.containerMargin, paddingBottom: Spacing.xl * 2, gap: Spacing.md },

  state:       { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  stateText:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  lockTitle:   { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  retry:       { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
                 borderRadius: Radius.md, backgroundColor: Colors.surfaceVariant },
  retryText:   { ...Typography.labelLg, color: Colors.onSurface },

  card:        { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.xs },
  cardHead:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  cardTitle:   { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  metaRow:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta:        { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  body:        { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  rubric:      { ...Typography.bodySm, color: Colors.onSurfaceVariant, fontStyle: 'italic' },

  gradedPill:  { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgGreen,
                 paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm },
  gradedText:  { ...Typography.labelSm, color: Colors.teal },
  submittedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgGold,
                   paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm },
  submittedText: { ...Typography.labelSm, color: Colors.gold },

  feedbackBox: { backgroundColor: Colors.iconBgGreen, borderRadius: Radius.md, padding: Spacing.md,
                 marginTop: Spacing.xs, gap: 2 },
  feedbackLabel: { ...Typography.labelSm, color: Colors.teal },
  feedbackText:  { ...Typography.bodyMd, color: Colors.onSurface },

  linkRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.xs },
  linkText:    { ...Typography.bodySm, color: Colors.gold, flex: 1 },

  form:        { gap: Spacing.xs, marginTop: Spacing.sm },
  fieldLabel:  { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  input:       { backgroundColor: Colors.background, borderRadius: Radius.md, padding: Spacing.md,
                 color: Colors.onSurface, borderWidth: 1, borderColor: Colors.surfaceVariant,
                 ...Typography.bodyMd },
  inputMultiline: { minHeight: 88, textAlignVertical: 'top' },
  error:       { ...Typography.bodySm, color: Colors.error },

  sendBtn:     { backgroundColor: Colors.gold, borderRadius: Radius.md, paddingVertical: Spacing.md,
                 alignItems: 'center', marginTop: Spacing.xs },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { ...Typography.labelLg, color: Colors.black },
  editBtn:     { paddingVertical: Spacing.sm, alignItems: 'center' },
  editBtnText: { ...Typography.labelLg, color: Colors.gold },
});
