import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Flag, Ban, Heart, MapPin, CircleCheck, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { REPORT_REASONS } from '@/features/connect/messaging/api';
import { useReportUser, useBlockUser, useUnmatch } from '@/features/connect/messaging/hooks';
import type { SafetyCaseResult } from '@/features/connect/messaging/types';

// MS-07 — In-chat safety hub. §7: every report / block / unmatch ALWAYS
// resolves with a caseId; the UI MUST surface it in a confirmation and NEVER
// swallow it. Mutation errors are shown inline, never silently.

export default function SafetyHub() {
  const params = useLocalSearchParams<{ threadId?: string; peerId?: string; name?: string; mode?: string }>();
  const threadId = String(params.threadId ?? '');
  const peerId = String(params.peerId ?? '');
  const name = String(params.name ?? 'this user');
  const mode = String(params.mode ?? '');

  const report = useReportUser();
  const block = useBlockUser();
  const unmatch = useUnmatch();

  const [showReport, setShowReport] = useState(false);
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [result, setResult] = useState<SafetyCaseResult | null>(null);

  const submitReport = () => {
    if (!reasonCode) return;
    report.mutate(
      { peerId, reasonCode, details: details.trim() || undefined },
      { onSuccess: (res) => setResult(res) },
    );
  };
  const submitBlock = () => {
    block.mutate(peerId, { onSuccess: (res) => setResult(res) });
  };
  const submitUnmatch = () => {
    unmatch.mutate({ threadId, peerId }, { onSuccess: (res) => setResult(res) });
  };

  // §7 — confirmation card surfacing result.message AND the caseId.
  if (result) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Done" showBack={false} />
        <View style={styles.confirmWrap}>
          <View style={styles.confirmIcon}>
            <CircleCheck size={40} color={ConnectColors.ok} strokeWidth={2} />
          </View>
          <Text style={styles.confirmTitle}>
            {result.action === 'report' ? 'Report filed' : result.action === 'block' ? 'User blocked' : 'Unmatched'}
          </Text>
          <Text style={styles.confirmMessage}>{result.message}</Text>
          <View style={styles.caseChip}>
            <Text style={styles.caseChipText}>Case {result.caseId}</Text>
          </View>
          <View style={styles.confirmAction}>
            <PrimaryButton
              label="Done"
              onPress={() => {
                // After a block/unmatch the thread is gone — return to inbox.
                if (result.action === 'report') goBack('/connect');
                else router.replace('/connect/messaging/inbox');
              }}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Safety" subtitle={name} />

      <ScrollView contentContainerStyle={styles.body}>
        {/* Report */}
        {!showReport ? (
          <Pressable style={styles.actionRow} onPress={() => setShowReport(true)}>
            <View style={[styles.actionIcon, styles.iconDanger]}>
              <Flag size={20} color={ConnectColors.danger} strokeWidth={2} />
            </View>
            <View style={styles.actionTextWrap}>
              <Text style={styles.actionTitle}>Report {name}</Text>
              <Text style={styles.actionSub}>Tell our safety team what happened.</Text>
            </View>
          </Pressable>
        ) : (
          <View style={styles.reportCard}>
            <Text style={styles.sectionTitle}>Why are you reporting {name}?</Text>
            {REPORT_REASONS.map((r) => {
              const selected = reasonCode === r.code;
              return (
                <Pressable
                  key={r.code}
                  style={[styles.reasonRow, selected && styles.reasonRowSelected]}
                  onPress={() => setReasonCode(r.code)}
                >
                  <Text style={[styles.reasonLabel, selected && styles.reasonLabelSelected]}>{r.label}</Text>
                  {selected ? <Check size={18} color={ConnectColors.brand} strokeWidth={2.6} /> : null}
                </Pressable>
              );
            })}

            <View style={styles.detailsWrap}>
              <TextInputField
                label="Add details (optional)"
                value={details}
                onChangeText={setDetails}
                placeholder="What happened?"
                multiline
              />
            </View>

            {report.error ? (
              <Text style={styles.errorText}>Could not file the report. Please try again.</Text>
            ) : null}

            <PrimaryButton
              label="Submit report"
              variant="danger"
              onPress={submitReport}
              loading={report.isPending}
              disabled={!reasonCode}
            />
            <View style={styles.cancelWrap}>
              <PrimaryButton label="Cancel" variant="ghost" onPress={() => setShowReport(false)} />
            </View>
          </View>
        )}

        {/* Block */}
        {!showReport ? (
          <View style={styles.blockCard}>
            <View style={styles.actionRowInline}>
              <View style={[styles.actionIcon, styles.iconDanger]}>
                <Ban size={20} color={ConnectColors.danger} strokeWidth={2} />
              </View>
              <View style={styles.actionTextWrap}>
                <Text style={styles.actionTitle}>Block {name}</Text>
                <Text style={styles.actionSub}>
                  They can no longer see your profile or contact you. This removes the conversation.
                </Text>
              </View>
            </View>
            {block.error ? (
              <Text style={styles.errorText}>Could not block. Please try again.</Text>
            ) : null}
            <PrimaryButton label={`Block ${name}`} variant="danger" onPress={submitBlock} loading={block.isPending} />
          </View>
        ) : null}

        {/* Unmatch — Date mode only */}
        {!showReport && mode === 'date' ? (
          <View style={styles.blockCard}>
            <View style={styles.actionRowInline}>
              <View style={[styles.actionIcon, styles.iconNeutral]}>
                <Heart size={20} color={ConnectColors.muted} strokeWidth={2} />
              </View>
              <View style={styles.actionTextWrap}>
                <Text style={styles.actionTitle}>Unmatch</Text>
                <Text style={styles.actionSub}>End the match and remove this conversation.</Text>
              </View>
            </View>
            {unmatch.error ? (
              <Text style={styles.errorText}>Could not unmatch. Please try again.</Text>
            ) : null}
            <PrimaryButton label="Unmatch" variant="secondary" onPress={submitUnmatch} loading={unmatch.isPending} />
          </View>
        ) : null}

        {/* Location info (§3) */}
        {!showReport ? (
          <View style={styles.infoRow}>
            <MapPin size={18} color={ConnectColors.brand} strokeWidth={2} />
            <Text style={styles.infoText}>
              When you share your location in chat, only an approximate area (e.g. “Around Victoria Island, Lagos”)
              is sent — never your exact coordinates.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.containerMargin, gap: Spacing.md },

  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
  },
  actionRowInline: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, marginBottom: Spacing.sm },
  actionIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  iconDanger: { backgroundColor: Colors.errorContainer },
  iconNeutral: { backgroundColor: Colors.surfaceContainerHigh },
  actionTextWrap: { flex: 1, gap: 2 },
  actionTitle: { ...Typography.labelLg, color: Colors.onSurface },
  actionSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },

  reportCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.sm,
  },
  blockCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
  },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  reasonRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.md,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLow,
  },
  reasonRowSelected: { borderColor: ConnectColors.brand, backgroundColor: Colors.iconBgPurple },
  reasonLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  reasonLabelSelected: { color: ConnectColors.brand, fontWeight: '600' },
  detailsWrap: { marginTop: Spacing.sm },
  cancelWrap: { marginTop: Spacing.xs },
  errorText: { ...Typography.labelSm, color: Colors.error, marginBottom: Spacing.sm },

  infoRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md,
  },
  infoText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },

  confirmWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  confirmIcon: {
    width: 72, height: 72, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  confirmMessage: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  caseChip: {
    backgroundColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  caseChipText: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' },
  confirmAction: { width: '100%', marginTop: Spacing.md },
});
