import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Users, CloudUpload, ClipboardCheck, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { VisitorColors } from '@/features/visitor/constants/visitor.constants';
import { useGateSession, useOpenVisits, usePendingSyncCount, useSubmitHandover } from '@/features/visitor/hooks/useVisitor';
import { formatTime } from '@/features/visitor/utils/visitorFormatters';

export default function HandoverScreen() {
  const session = useGateSession();
  const open = useOpenVisits();
  const pending = usePendingSyncCount();
  const handover = useSubmitHandover();

  const [notes, setNotes] = useState('');
  const [done, setDone] = useState(false);

  if (session.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Shift handover" />
        <StateView kind="loading" message="Loading shift…" />
      </SafeAreaView>
    );
  }
  if (session.isError || !session.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Shift handover" />
        <StateView kind="error" title="Couldn't load shift" message="Please try again." actionLabel="Retry" onAction={() => session.refetch()} />
      </SafeAreaView>
    );
  }

  const gs = session.data;
  const openCount = open.data?.length ?? 0;
  const pendingCount = pending.data ?? 0;

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Shift handed over" showBack={false} />
        <View style={styles.resultWrap}>
          <View style={[styles.bigIcon, { backgroundColor: Colors.iconBgTeal }]}>
            <CircleCheck size={46} color={Colors.teal} strokeWidth={1.6} />
          </View>
          <Text style={styles.resultTitle}>Handover complete</Text>
          <Text style={styles.resultBody}>The next guard will see {openCount} open visit{openCount === 1 ? '' : 's'} and your notes.</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Done" onPress={() => router.replace('/guard')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Shift handover" subtitle={`${gs.gateLabel} · since ${formatTime(gs.shiftStart)}`} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Summary */}
          <View style={styles.summaryRow}>
            <SummaryCard icon={<Users size={20} color={Colors.secondary} />} bg={Colors.iconBgBlue} value={String(openCount)} label="Open visits" />
            <SummaryCard icon={<CloudUpload size={20} color={pendingCount ? VisitorColors.warning : Colors.teal} />} bg={pendingCount ? VisitorColors.warningBg : Colors.iconBgTeal} value={String(pendingCount)} label="Pending sync" />
          </View>

          {pendingCount > 0 ? (
            <View style={styles.warnNote}>
              <CloudUpload size={16} color={VisitorColors.warning} strokeWidth={1.8} />
              <Text style={styles.warnText}>Sync pending logs before handing over so the next guard has the full record.</Text>
            </View>
          ) : null}

          <View style={styles.notesHeader}>
            <ClipboardCheck size={18} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
            <Text style={styles.notesLabel}>Handover notes</Text>
          </View>
          <TextInputField
            placeholder="Anything the next guard should know (open issues, expected VIPs, incidents)…"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={5}
            style={styles.notesInput}
          />
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton label="Complete handover" onPress={() => handover.mutate({ gateId: gs.gateId, notes }, { onSuccess: () => setDone(true) })} loading={handover.isPending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SummaryCard({ icon, bg, value, label }: { icon: React.ReactNode; bg: string; value: string; label: string }) {
  return (
    <View style={styles.summaryCard}>
      <View style={[styles.summaryIcon, { backgroundColor: bg }]}>{icon}</View>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  summaryRow: { flexDirection: 'row', gap: Spacing.md },
  summaryCard: {
    flex: 1, gap: 2, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1,
  },
  summaryIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  summaryValue: { ...Typography.headlineMd, color: Colors.onSurface },
  summaryLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  warnNote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: VisitorColors.warningBg, borderRadius: Radius.md, padding: Spacing.md },
  warnText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  notesHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  notesLabel: { ...Typography.labelMd, color: Colors.onSurface },
  notesInput: { minHeight: 120, textAlignVertical: 'top', paddingTop: Spacing.md },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
  resultWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  bigIcon: { width: 92, height: 92, borderRadius: Radius.xxl, alignItems: 'center', justifyContent: 'center' },
  resultTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  resultBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
