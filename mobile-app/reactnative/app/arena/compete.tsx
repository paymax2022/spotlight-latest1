import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ClipboardCheck, GraduationCap, CalendarClock, Award, Trophy, XCircle, Clock, MapPin, FileCheck2, ChevronRight, PlayCircle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useMe, useMyMerit, useTraining, useCompetition } from '@/features/arena/hooks';
import Stepper from '@/features/arena/components/Stepper';
import Countdown from '@/features/arena/components/Countdown';
import {
  STATE_LABELS, MERIT_STAGE_LABELS, TERMINAL_STATES, NDC1_MERIT_NOTE, lastUpdatedLabel,
} from '@/features/arena/constants';
import type { Contestant, ContestantState } from '@/features/arena/types';

/**
 * Compete tab — STATE-DRIVEN. Reads GET /competitions/{id}/me and renders the
 * screen matching the current lifecycle state (ARENA-PRD §8) with a progress
 * stepper on top. Offline-tolerant read with a "last updated" stamp.
 *
 *   no contestant → C0 Enter · APPLIED/SCREENED → C3 · SCREENED→TRAINED → C4
 *   THEORY_ASSIGNED → C5 (countdown + readiness) · exam window open → C6 (push)
 *   THEORY_TAKEN → merit-pending · QUALIFIED → C7 · FINALIST → C8 · CROWNED → C9 link
 *   ELIMINATED/REJECTED/WITHDRAWN → terminal (with credential if earned)
 */
export default function CompeteScreen() {
  const { competitionId: raw } = useLocalSearchParams<{ competitionId?: string }>();
  const competitionId = raw ?? '';
  const comp = useCompetition(competitionId);
  const me = useMe(competitionId, 30_000);

  const refreshing = me.isRefetching || comp.isRefetching;
  const onRefresh = () => {
    me.refetch();
    comp.refetch();
  };

  if (me.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Compete" />
        <StateView kind="loading" message="Loading your progress…" />
      </SafeAreaView>
    );
  }

  if (me.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Compete" />
        <StateView kind="error" title="Couldn’t load your progress" message="Showing this needs a connection. Try again." actionLabel="Retry" onAction={onRefresh} />
      </SafeAreaView>
    );
  }

  const contestant = me.data?.contestant ?? null;

  // C0 — not a contestant yet.
  if (!contestant) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Compete" />
        <View style={styles.center}>
          <StateView
            kind="empty"
            icon="Flag"
            title="You’re not competing yet"
            message="Enter the challenge to become a Certified Safe Driver and climb the Merit leaderboard."
            actionLabel="Enter the Challenge"
            onAction={() => router.push({ pathname: '/arena/enter', params: { competitionId } })}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Compete" subtitle={comp.data?.title} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        <View style={[styles.stepperCard, shadow1]}>
          <Stepper state={contestant.state} />
        </View>
        <Text style={styles.stamp}>{lastUpdatedLabel(new Date().toISOString())}</Text>

        <StageBody contestant={contestant} competitionId={competitionId} />
      </ScrollView>
    </SafeAreaView>
  );
}

/** Dispatches the body content by lifecycle state. */
function StageBody({ contestant, competitionId }: { contestant: Contestant; competitionId: string }) {
  const state = contestant.state;

  switch (state) {
    case 'APPLIED':
      return (
        <StageCard Icon={Clock} tint={Colors.iconBgBlue} iconColor={Colors.secondary}
          title="Application under review"
          body="Thanks for applying! Our screening team is reviewing your details. You’ll be notified when screening completes — usually within a few days.">
          {contestant.reason ? <Note>{contestant.reason}</Note> : null}
        </StageCard>
      );

    case 'SCREENED':
      return (
        <StageCard Icon={ClipboardCheck} tint={Colors.iconBgTeal} iconColor={Colors.teal}
          title="Screening passed"
          body="Congratulations — you cleared screening. Work through your training modules below to unlock the theory exam.">
          <TrainingInline competitionId={competitionId} />
        </StageCard>
      );

    case 'TRAINED':
      return (
        <StageCard Icon={GraduationCap} tint={Colors.iconBgTeal} iconColor={Colors.teal}
          title="Training complete"
          body="Well done. You’re ready for exam-batch assignment. We’ll assign your batch and share the exam window shortly.">
          <TrainingInline competitionId={competitionId} />
        </StageCard>
      );

    case 'THEORY_ASSIGNED':
      return <BatchAssignment contestant={contestant} competitionId={competitionId} />;

    case 'THEORY_TAKEN':
      return (
        <StageCard Icon={FileCheck2} tint={Colors.iconBgBlue} iconColor={Colors.secondary}
          title="Exam submitted"
          body="Your exam is in. Your Merit score is being reviewed and signed by proctors. We’ll update your standing once it’s resolved.">
          <MeritInline competitionId={competitionId} />
        </StageCard>
      );

    case 'QUALIFIED':
      return (
        <StageCard Icon={Award} tint={Colors.iconBgGold} iconColor={Colors.gold}
          title="You qualified!"
          body="Your Merit cleared the theory cutoff. See exactly where you stand below.">
          <MeritInline competitionId={competitionId} showCutoff />
          <PrimaryButton label="View public leaderboard" variant="secondary" onPress={() => router.push({ pathname: '/arena', params: { competitionId } })} />
        </StageCard>
      );

    case 'FINALIST':
      return <FinalistLogistics contestant={contestant} competitionId={competitionId} />;

    case 'CROWNED':
      return (
        <StageCard Icon={Trophy} tint={Colors.iconBgGold} iconColor={Colors.gold}
          title="Crowned — Naija Driver! 🏆"
          body="You won the crown, decided purely on Merit. Your Naija Driver credential is in your wallet.">
          <PrimaryButton label="Open credential wallet" onPress={() => router.push({ pathname: '/arena/credentials', params: { competitionId } })} />
          <MeritInline competitionId={competitionId} />
        </StageCard>
      );

    case 'ELIMINATED':
    case 'REJECTED':
    case 'WITHDRAWN':
      return (
        <StageCard Icon={XCircle} tint={Colors.iconBgRed} iconColor={Colors.error}
          title={STATE_LABELS[state]}
          body={
            state === 'REJECTED'
              ? 'You weren’t selected this time. Screening feedback is below — you’re welcome to re-enter in a future season.'
              : state === 'WITHDRAWN'
                ? 'You’ve withdrawn from this competition.'
                : 'Your journey ends here this season. Any credential you earned is still yours — check your wallet.'
          }>
          {contestant.reason ? <Note>{contestant.reason}</Note> : null}
          <PrimaryButton label="Credential wallet" variant="secondary" onPress={() => router.push({ pathname: '/arena/credentials', params: { competitionId } })} />
        </StageCard>
      );

    default:
      return <StageCard Icon={Clock} tint={Colors.iconBgBlue} iconColor={Colors.secondary} title={STATE_LABELS[state as ContestantState] ?? 'In progress'} body="We’ll update this as your status changes." />;
  }
}

// ─── C5 batch assignment + T-minus + readiness ──────────────────────────────

function BatchAssignment({ contestant, competitionId }: { contestant: Contestant; competitionId: string }) {
  const opens = contestant.examWindowOpensAt ? new Date(contestant.examWindowOpensAt).getTime() : NaN;
  const windowOpen = !Number.isNaN(opens) && Date.now() >= opens;

  return (
    <StageCard Icon={CalendarClock} tint={Colors.iconBgPurple} iconColor={Colors.primary}
      title={`Exam batch ${contestant.theoryBatch ?? '—'}`}
      body="You’re assigned to a theory exam batch. The exam is proctored and online-required — make sure you’re on a stable connection when the window opens.">
      <Countdown targetIso={contestant.examWindowOpensAt} label="Exam window opens in" />
      {/* Readiness check */}
      <View style={styles.readyBox}>
        <Text style={styles.readyTitle}>Readiness check</Text>
        <ReadyItem ok label="You’re on a supported device" />
        <ReadyItem ok label="Camera permission for proctoring (stubbed in sandbox)" />
        <ReadyItem ok={windowOpen} label={windowOpen ? 'Exam window is open' : 'Waiting for exam window'} />
      </View>
      <PrimaryButton
        label={windowOpen ? 'Start proctored exam' : 'Exam not open yet'}
        disabled={!windowOpen}
        onPress={() => router.push({ pathname: '/arena/exam', params: { competitionId } })}
      />
    </StageCard>
  );
}

function ReadyItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <View style={styles.readyItem}>
      <View style={[styles.readyDot, ok ? styles.readyDotOk : styles.readyDotWait]} />
      <Text style={styles.readyLabel}>{label}</Text>
    </View>
  );
}

// ─── C8 finalist logistics ──────────────────────────────────────────────────

function FinalistLogistics({ contestant, competitionId }: { contestant: Contestant; competitionId: string }) {
  return (
    <StageCard Icon={Trophy} tint={Colors.iconBgGold} iconColor={Colors.gold}
      title="You’re a Finalist!"
      body="You advanced to the Lagos finale on Merit. Here are your logistics.">
      <View style={styles.logRow}><MapPin size={16} color={Colors.secondary} /><Text style={styles.logText}>Venue and check-in details will appear here.</Text></View>
      <PrimaryButton label="Check-in QR + stream link" onPress={() => router.push({ pathname: '/arena/finale', params: { competitionId, finalist: '1' } })} />
      <MeritInline competitionId={competitionId} />
    </StageCard>
  );
}

// ─── Inline read fragments ──────────────────────────────────────────────────

function MeritInline({ competitionId, showCutoff }: { competitionId: string; showCutoff?: boolean }) {
  const merit = useMyMerit(competitionId);
  if (merit.isLoading) return <StateView kind="loading" compact />;
  const data = merit.data;
  if (!data || data.entries.length === 0) {
    return <Note>Your Merit entries will appear here as stages are scored and signed.</Note>;
  }
  return (
    <View style={styles.meritBox}>
      <View style={styles.meritHead}>
        <Text style={styles.meritBoxTitle}>Your Merit</Text>
        <Text style={styles.meritTotal}>{data.totalPoints} pts</Text>
      </View>
      {data.entries.map((e) => (
        <View key={e.stage} style={styles.meritRow}>
          <Text style={styles.meritStage}>{MERIT_STAGE_LABELS[e.stage]}</Text>
          <Text style={styles.meritVal}>{e.points}{e.maxPoints ? ` / ${e.maxPoints}` : ''}</Text>
        </View>
      ))}
      {showCutoff && data.cutoffPoints != null ? (
        <View style={styles.cutoffRow}>
          <Text style={styles.cutoffLabel}>Qualification cutoff</Text>
          <Text style={styles.cutoffVal}>{data.cutoffPoints} pts</Text>
        </View>
      ) : null}
      <Note>{NDC1_MERIT_NOTE}</Note>
    </View>
  );
}

function TrainingInline({ competitionId }: { competitionId: string }) {
  const training = useTraining(competitionId);
  const mods = training.data ?? [];
  if (training.isLoading) return <StateView kind="loading" compact />;
  if (mods.length === 0) return null;
  const done = mods.filter((m) => m.completed).length;
  return (
    <View style={styles.meritBox}>
      <View style={styles.meritHead}>
        <Text style={styles.meritBoxTitle}>Training progress</Text>
        <Text style={styles.meritTotal}>{done}/{mods.length}</Text>
      </View>
      {mods.slice(0, 5).map((m) => (
        <View key={m.id} style={styles.meritRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flex: 1 }}>
            <PlayCircle size={14} color={m.completed ? Colors.teal : Colors.onSurfaceVariant} />
            <Text style={styles.meritStage} numberOfLines={1}>{m.title}</Text>
          </View>
          <ChevronRight size={16} color={Colors.outline} />
        </View>
      ))}
      <Note>Modules are cached for offline study — your progress syncs when you’re back online.</Note>
    </View>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

function StageCard({
  Icon, tint, iconColor, title, body, children,
}: {
  Icon: typeof Clock; tint: string; iconColor: string; title: string; body: string; children?: React.ReactNode;
}) {
  return (
    <View style={[styles.stageCard, shadow1]}>
      <View style={[styles.stageIcon, { backgroundColor: tint }]}><Icon size={26} color={iconColor} strokeWidth={2} /></View>
      <Text style={styles.stageTitle}>{title}</Text>
      <Text style={styles.stageBody}>{body}</Text>
      {children ? <View style={styles.stageChildren}>{children}</View> : null}
    </View>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.note}>
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md },
  center: { flex: 1, justifyContent: 'center' },
  stepperCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  stamp: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: -Spacing.xs, marginLeft: Spacing.xs },
  stageCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.xs, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  stageIcon: { width: 56, height: 56, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  stageTitle: { ...Typography.titleLg, color: Colors.onSurface },
  stageBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  stageChildren: { marginTop: Spacing.md, gap: Spacing.md, alignSelf: 'stretch' },
  note: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  noteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  readyBox: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  readyTitle: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: Spacing.xs },
  readyItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  readyDot: { width: 10, height: 10, borderRadius: Radius.full },
  readyDotOk: { backgroundColor: Colors.teal },
  readyDotWait: { backgroundColor: Colors.outline },
  readyLabel: { ...Typography.labelSm, color: Colors.onSurface, flex: 1 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  logText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  meritBox: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  meritHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  meritBoxTitle: { ...Typography.labelLg, color: Colors.onSurface },
  meritTotal: { ...Typography.titleMd, color: Colors.primary },
  meritRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  meritStage: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  meritVal: { ...Typography.labelMd, color: Colors.onSurface },
  cutoffRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, paddingTop: Spacing.sm },
  cutoffLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  cutoffVal: { ...Typography.labelMd, color: Colors.secondary },
});
