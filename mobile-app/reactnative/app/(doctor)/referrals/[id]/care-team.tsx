import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, Platform, KeyboardAvoidingView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Users, FileText, ChevronDown, ChevronUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView, ChatComposer, SectionCard, InfoRow } from '@/features/doctor/components';
import { useCareTeamThread, useSendCareTeamMessage, useSharedCaseSummary } from '@/features/doctor/hooks';
import type { CareTeamMessage } from '@/types/doctor.batch4';

// Section P (P14, P15) — care-team multi-clinician chat with the shared case
// summary surfaced as a collapsible header (STATE of this screen). Reuses
// ChatComposer; the team bubble is inline (CareTeamMessage author shape differs
// from the Phase 1 ChatMessage MessageBubble expects).
export default function CareTeamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const caseRef = String(id);
  const thread = useCareTeamThread('ctt-1');
  const summary = useSharedCaseSummary(caseRef);
  const send = useSendCareTeamMessage();
  const [showSummary, setShowSummary] = useState(false);

  const handleSend = async (body: string) => {
    try {
      await send.mutateAsync({ threadId: thread.data?.threadId ?? 'ctt-1', body });
    } catch {
      Alert.alert('Failed', 'Could not send the message. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Care Team" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        {/* P15 — shared case summary (collapsible) */}
        <Pressable style={styles.summaryToggle} onPress={() => setShowSummary((s) => !s)} accessibilityRole="button" accessibilityLabel="Toggle shared case summary">
          <FileText size={16} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.summaryToggleText}>Shared case summary</Text>
          {showSummary ? <ChevronUp size={18} color={Colors.onSurfaceVariant} strokeWidth={2} /> : <ChevronDown size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />}
        </Pressable>

        {showSummary && (
          summary.isLoading && !summary.data ? (
            <View style={styles.summaryWrap}><StateView variant="loading" label="Loading summary" /></View>
          ) : summary.isError || !summary.data ? (
            <View style={styles.summaryWrap}><StateView variant="error" message="We could not load the case summary." onRetry={() => summary.refetch()} /></View>
          ) : (
            <View style={styles.summaryWrap}>
              <SectionCard style={styles.summaryCard}>
                <Text style={styles.summaryNarrative}>{summary.data.summary}</Text>
                <InfoRow label="Case ref" value={summary.data.caseRef} />
                {summary.data.diagnoses.length > 0 && <InfoRow label="Diagnoses" value={summary.data.diagnoses.join(', ')} />}
                <InfoRow label="Notes" value={`${summary.data.notes.length}`} />
                <InfoRow label="Prescriptions" value={`${summary.data.prescriptions.length}`} />
                <InfoRow label="Lab results" value={`${summary.data.labResults.length}`} />
                {summary.data.sharedWith.length > 0 && <InfoRow label="Shared with" value={summary.data.sharedWith.join(', ')} />}
              </SectionCard>
            </View>
          )
        )}

        {thread.isLoading && !thread.data ? (
          <StateView variant="loading" label="Loading conversation" />
        ) : thread.isError || !thread.data ? (
          <StateView variant="error" message="We could not load the care team." onRetry={() => thread.refetch()} />
        ) : (
          <FlatList
            data={thread.data.messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              thread.data.members.length > 0 ? (
                <View style={styles.members}>
                  <Users size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  <Text style={styles.membersText} numberOfLines={2}>{thread.data.members.map((m) => `${m.name} (${m.role})`).join(' · ')}</Text>
                </View>
              ) : null
            }
            ListEmptyComponent={<StateView variant="empty" icon={Users} title="No messages yet" message="Start the care-team discussion." />}
            renderItem={({ item }) => <Bubble message={item} />}
          />
        )}
        <ChatComposer onSend={handleSend} sending={send.isPending} placeholder="Message the care team" />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({ message }: { message: CareTeamMessage }) {
  const mine = message.authorId === 'doc-self';
  const time = new Date(message.createdAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!mine && <Text style={styles.author}>{message.authorName} · {message.authorRole}</Text>}
        <Text style={[styles.body, mine && styles.textMine]}>{message.body}</Text>
        <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>{time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: Colors.background },
  flex:             { flex: 1 },
  summaryToggle:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  summaryToggleText:{ ...Typography.labelMd, color: Colors.primary, flex: 1 },
  summaryWrap:      { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  summaryCard:      { gap: 2 },
  summaryNarrative: { ...Typography.bodyMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  list:             { padding: Spacing.containerMargin, gap: Spacing.sm, flexGrow: 1 },
  members:          { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingBottom: Spacing.sm },
  membersText:      { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
  row:              { width: '100%', flexDirection: 'row' },
  rowMine:          { justifyContent: 'flex-end' },
  rowTheirs:        { justifyContent: 'flex-start' },
  bubble:           { maxWidth: '82%', padding: Spacing.sm, borderRadius: Radius.lg, gap: 2 },
  bubbleMine:       { backgroundColor: Colors.primary, borderBottomRightRadius: Radius.sm },
  bubbleTheirs:     { backgroundColor: Colors.surfaceContainerLow, borderBottomLeftRadius: Radius.sm },
  author:           { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' },
  body:             { ...Typography.bodyMd, color: Colors.onSurface },
  textMine:         { color: Colors.onPrimary },
  time:             { ...Typography.caption },
  timeMine:         { color: Colors.onPrimary, opacity: 0.7, textAlign: 'right' },
  timeTheirs:       { color: Colors.onSurfaceVariant },
});
