import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  MessageCircle, NotebookPen, RefreshCw, AlertTriangle, ShieldAlert, Wrench, X, VideoOff,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import { StatusBadge, CallStageView, CallControlBar, StateView } from '@/features/doctor/components';
import { RatingStars } from '@/features/telemedicine/components';
import {
  useCallSessionRich, useJoinCall, useLeaveCall, useSwitchProvider,
  useSubmitCallFeedback, useRaiseCallDispute, useReportTechnicalIssue, useUpdateAppointmentStatus,
} from '@/features/doctor/hooks';
import { CALL_PROVIDER_LABELS, NETWORK_QUALITY_LABELS, TECHNICAL_ISSUE_CATEGORIES, CALL_DISPUTE_REASONS } from '@/features/doctor/constants';
import type { CallControls, CallDurationSummary, NetworkQuality } from '@/types/doctor.batch2';

type SheetKind = 'summary' | 'feedback' | 'dispute' | 'tech' | null;
const toBadgeTone = (q: NetworkQuality) => {
  const t = NETWORK_QUALITY_LABELS[q].tone;
  return (t === 'success' ? 'success' : t === 'warning' ? 'warning' : t === 'danger' ? 'danger' : 'neutral') as 'success' | 'warning' | 'danger' | 'neutral';
};

export default function ConsultCallScreen() {
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>();
  const appointmentId = String(id);

  const { data: session, isLoading, isError, refetch } = useCallSessionRich(appointmentId);
  const joinCall      = useJoinCall();
  const leaveCall     = useLeaveCall();
  const switchProvider = useSwitchProvider();
  const submitFeedback = useSubmitCallFeedback();
  const raiseDispute  = useRaiseCallDispute();
  const reportTech    = useReportTechnicalIssue();
  const updateStatus  = useUpdateAppointmentStatus();

  const [controls, setControls] = useState<CallControls>({ muted: false, cameraOn: true, speakerOn: true, frontCamera: true, minimized: false });
  const [seconds, setSeconds]   = useState(0);
  const [sheet, setSheet]       = useState<SheetKind>(null);
  const [summary, setSummary]   = useState<CallDurationSummary | null>(null);

  // feedback / dispute / tech form state
  const [rating, setRating]       = useState(5);
  const [audioOk, setAudioOk]     = useState(true);
  const [videoOk, setVideoOk]     = useState(true);
  const [comment, setComment]     = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [techCategory, setTechCategory]   = useState('');
  const [techDetail, setTechDetail]       = useState('');

  const isVideo = (mode ?? session?.base.mode) !== 'audio';
  const phase = session?.phase ?? 'connecting';
  const isLive = phase === 'live';

  useEffect(() => {
    if (!isLive) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isLive]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  const endCall = async () => {
    try {
      const res = await leaveCall.mutateAsync({ appointmentId });
      setSummary(res.summary);
      await updateStatus.mutateAsync({ appointmentId, status: 'completed' });
      setSheet('summary');
    } catch {
      Alert.alert('Could not end the call', 'Please try again.');
    }
  };

  const doJoin = async (m: 'audio' | 'video') => {
    try { await joinCall.mutateAsync({ appointmentId, mode: m }); } catch { Alert.alert('Could not join', 'Please try again.'); }
  };

  const doFallback = async () => {
    try { await switchProvider.mutateAsync({ appointmentId, to: 'videosdk' }); } catch { Alert.alert('Fallback failed', 'Please try again.'); }
  };

  const doSubmitFeedback = async () => {
    try {
      await submitFeedback.mutateAsync({ appointmentId, rating: rating as 1 | 2 | 3 | 4 | 5, audioOk, videoOk, comment: comment || undefined });
      setSheet(null);
      Alert.alert('Thank you', 'Your call feedback has been recorded.');
      router.replace(`/(doctor)/consult/${appointmentId}/notes`);
    } catch { Alert.alert('Failed', 'Please try again.'); }
  };

  const doRaiseDispute = async () => {
    if (!disputeReason) { Alert.alert('Select a reason', 'Choose why you are disputing this call.'); return; }
    try {
      const res = await raiseDispute.mutateAsync({ appointmentId, reason: disputeReason });
      setSheet(null); setDisputeReason('');
      Alert.alert('Dispute raised', `Reference ${res.ref}. Our team will review this failed call.`);
    } catch { Alert.alert('Failed', 'Please try again.'); }
  };

  const doReportTech = async () => {
    if (!techCategory) { Alert.alert('Select a category', 'Choose the issue category.'); return; }
    try {
      const res = await reportTech.mutateAsync({ appointmentId, category: techCategory, detail: techDetail });
      setSheet(null); setTechCategory(''); setTechDetail('');
      Alert.alert('Reported', `Ticket ${res.ref} created. Thank you.`);
    } catch { Alert.alert('Failed', 'Please try again.'); }
  };

  const subline = session
    ? `${CALL_PROVIDER_LABELS[session.provider]} · ${NETWORK_QUALITY_LABELS[session.networkQuality].label} network`
    : undefined;

  if (isLoading && !session) {
    return (
      <SafeAreaView style={styles.safeLight} edges={['top']}>
        <StateView variant="loading" label="Preparing call" />
      </SafeAreaView>
    );
  }
  if (isError || !session) {
    return (
      <SafeAreaView style={styles.safeLight} edges={['top']}>
        <StateView variant="error" message="We could not start this call." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <LinearGradient colors={[Colors.primary, Colors.primaryContainer]} style={StyleSheet.absoluteFill} />

      <View style={styles.topBar}>
        <View style={styles.topLeft}>
          <View style={styles.liveTag}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>{phase.replace('_', ' ').toUpperCase()}</Text>
          </View>
          <StatusBadge label={NETWORK_QUALITY_LABELS[session.networkQuality].label} tone={toBadgeTone(session.networkQuality)} />
        </View>
        <View style={styles.topRight}>
          <Pressable onPress={() => router.push(`/(doctor)/consult/${appointmentId}/pre-call?mode=${isVideo ? 'video' : 'audio'}`)} style={styles.topIcon} accessibilityRole="button" accessibilityLabel="Pre-call checklist">
            <ShieldAlert size={18} color={Colors.white} strokeWidth={2} />
          </Pressable>
          <Text style={styles.timer}>{mm}:{ss}</Text>
        </View>
      </View>

      {/* Poor-network warning (I15) */}
      {session.networkQuality === 'poor' && (
        <Banner Icon={AlertTriangle} text="Poor network detected — audio/video may be affected." onAction={doFallback} actionLabel="Switch provider" />
      )}
      {/* Reconnecting (I16) */}
      {phase === 'reconnecting' && <Banner Icon={RefreshCw} text="Reconnecting…" />}
      {/* Agora failure → VideoSDK fallback (I18/I19) */}
      {session.providerFailed && session.provider === 'agora' && (
        <Banner Icon={AlertTriangle} text="Agora connection failed." onAction={doFallback} actionLabel="Use VideoSDK" loading={switchProvider.isPending} />
      )}
      {/* Participant disconnected (I22/I23) */}
      {!session.patientState.connected && <Banner Icon={AlertTriangle} text={`${session.base.patient.name} disconnected.`} />}
      {!session.doctorState.connected && <Banner Icon={AlertTriangle} text="You appear disconnected." />}

      {/* Stage — drives every CallPhase variant (I4/I5/I6/I7/I8/I16/I21/I24) */}
      <CallStageView
        phase={phase}
        patientName={session.base.patient.name}
        initials={session.base.patient.initials}
        avatarColor={session.base.patient.avatarColor}
        modeLabel={isVideo ? 'Video consultation' : 'Audio consultation'}
        subline={subline}
      />

      {/* Self preview (video) / minimized note */}
      {isVideo && !controls.minimized && (
        <View style={styles.selfPreview}>
          {controls.cameraOn ? <Text style={styles.selfText}>You</Text> : <VideoOff size={20} color={Colors.white} strokeWidth={2} />}
        </View>
      )}

      {/* Waiting room / ringing → join; live → controls */}
      {(phase === 'waiting_room' || phase === 'ringing' || phase === 'connecting') ? (
        <View style={styles.joinRow}>
          <PrimaryButton label={isVideo ? 'Join video call' : 'Join audio call'} onPress={() => doJoin(isVideo ? 'video' : 'audio')} loading={joinCall.isPending} />
          <Pressable onPress={() => router.push(`/(doctor)/consult/${appointmentId}/pre-call?mode=${isVideo ? 'video' : 'audio'}`)} style={styles.linkBtn} accessibilityRole="button" accessibilityLabel="Run pre-call checks">
            <Text style={styles.linkText}>Run pre-call checks</Text>
          </Pressable>
        </View>
      ) : (phase === 'dropped' || phase === 'ended' || phase === 'failed') ? (
        <View style={styles.joinRow}>
          <PrimaryButton label="Call feedback" onPress={() => setSheet('feedback')} />
          <View style={styles.endActions}>
            <Pressable onPress={() => setSheet('dispute')} style={styles.linkBtn} accessibilityRole="button" accessibilityLabel="Dispute failed call">
              <Text style={styles.linkText}>Dispute</Text>
            </Pressable>
            <Pressable onPress={() => setSheet('tech')} style={styles.linkBtn} accessibilityRole="button" accessibilityLabel="Report technical issue">
              <Text style={styles.linkText}>Report issue</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <CallControlBar
          controls={controls}
          isVideo={isVideo}
          onToggleMute={() => setControls((c) => ({ ...c, muted: !c.muted }))}
          onToggleCamera={() => setControls((c) => ({ ...c, cameraOn: !c.cameraOn }))}
          onSwitchCamera={() => setControls((c) => ({ ...c, frontCamera: !c.frontCamera }))}
          onToggleSpeaker={() => setControls((c) => ({ ...c, speakerOn: !c.speakerOn }))}
          onToggleMinimize={() => setControls((c) => ({ ...c, minimized: !c.minimized }))}
          onEnd={endCall}
        />
      )}

      {/* In-call quick links */}
      {isLive && (
        <View style={styles.quickRow}>
          <Pressable onPress={() => router.push(`/(doctor)/consult/${appointmentId}/chat`)} style={styles.quickBtn} accessibilityRole="button" accessibilityLabel="Open chat">
            <MessageCircle size={18} color={Colors.white} strokeWidth={2} />
          </Pressable>
          <Pressable onPress={() => router.push(`/(doctor)/consult/${appointmentId}/notes`)} style={styles.quickBtn} accessibilityRole="button" accessibilityLabel="Open notes">
            <NotebookPen size={18} color={Colors.white} strokeWidth={2} />
          </Pressable>
          <Pressable onPress={() => setSheet('tech')} style={styles.quickBtn} accessibilityRole="button" accessibilityLabel="Report technical issue">
            <Wrench size={18} color={Colors.white} strokeWidth={2} />
          </Pressable>
        </View>
      )}

      {/* Duration summary sheet (I25) */}
      <BottomSheet visible={sheet === 'summary'} title="Call summary" onClose={() => { setSheet(null); router.replace(`/(doctor)/consult/${appointmentId}/notes`); }}>
        {summary && (
          <View style={styles.summaryBody}>
            <SummaryRow label="Patient" value={summary.patient.name} />
            <SummaryRow label="Provider" value={CALL_PROVIDER_LABELS[summary.provider]} />
            <SummaryRow label="Mode" value={summary.mode === 'audio' ? 'Audio' : 'Video'} />
            <SummaryRow label="Duration" value={`${Math.floor(summary.durationSecs / 60)}m ${summary.durationSecs % 60}s`} />
            <SummaryRow label="Ended" value={summary.endedReason.replace('_', ' ')} />
            <PrimaryButton label="Leave feedback" onPress={() => setSheet('feedback')} style={styles.sheetBtn} />
            <PrimaryButton label="Go to notes" variant="secondary" onPress={() => { setSheet(null); router.replace(`/(doctor)/consult/${appointmentId}/notes`); }} style={styles.sheetBtn} />
          </View>
        )}
      </BottomSheet>

      {/* Call quality feedback sheet (I27) */}
      <BottomSheet visible={sheet === 'feedback'} title="Call quality feedback" onClose={() => setSheet(null)}>
        <View style={styles.feedbackStars}><RatingStars rating={rating} size={28} editable onChange={setRating} /></View>
        <ToggleLine label="Audio was clear" value={audioOk} onToggle={() => setAudioOk((v) => !v)} />
        <ToggleLine label="Video was clear" value={videoOk} onToggle={() => setVideoOk((v) => !v)} />
        <TextInput style={styles.input} placeholder="Add a comment (optional)" placeholderTextColor={Colors.outline} value={comment} onChangeText={setComment} multiline />
        <PrimaryButton label="Submit feedback" onPress={doSubmitFeedback} loading={submitFeedback.isPending} style={styles.sheetBtn} />
      </BottomSheet>

      {/* Failed-call dispute sheet (I26) */}
      <BottomSheet visible={sheet === 'dispute'} title="Dispute failed call" onClose={() => setSheet(null)}>
        <SelectField label="Reason" placeholder="Why are you disputing this call?" value={disputeReason} options={CALL_DISPUTE_REASONS} onChange={setDisputeReason} searchable={false} />
        <PrimaryButton label="Raise dispute" onPress={doRaiseDispute} loading={raiseDispute.isPending} style={styles.sheetBtn} />
      </BottomSheet>

      {/* Report technical issue sheet (I28) */}
      <BottomSheet visible={sheet === 'tech'} title="Report technical issue" onClose={() => setSheet(null)}>
        <SelectField label="Category" placeholder="Select an issue category" value={techCategory} options={TECHNICAL_ISSUE_CATEGORIES} onChange={setTechCategory} searchable={false} />
        <TextInput style={styles.input} placeholder="Describe what happened" placeholderTextColor={Colors.outline} value={techDetail} onChangeText={setTechDetail} multiline />
        <PrimaryButton label="Submit report" onPress={doReportTech} loading={reportTech.isPending} style={styles.sheetBtn} />
      </BottomSheet>
    </SafeAreaView>
  );
}

function Banner({ Icon, text, onAction, actionLabel, loading }: { Icon: typeof AlertTriangle; text: string; onAction?: () => void; actionLabel?: string; loading?: boolean }) {
  return (
    <View style={styles.banner}>
      <Icon size={16} color={Colors.white} strokeWidth={2} />
      <Text style={styles.bannerText} numberOfLines={2}>{text}</Text>
      {onAction && actionLabel && (
        <Pressable onPress={onAction} disabled={loading} style={styles.bannerBtn} accessibilityRole="button" accessibilityLabel={actionLabel}>
          <Text style={styles.bannerBtnText}>{loading ? '…' : actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function ToggleLine({ label, value, onToggle }: { label: string; value: boolean; onToggle: () => void }) {
  return (
    <Pressable style={styles.toggleLine} onPress={onToggle} accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
        <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
      </View>
    </Pressable>
  );
}

function BottomSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.primary },
  safeLight:   { flex: 1, backgroundColor: Colors.background },
  topBar:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md },
  topLeft:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  topRight:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  topIcon:     { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  liveTag:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 28, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.15)' },
  liveDot:     { width: 7, height: 7, borderRadius: Radius.full, backgroundColor: Colors.teal },
  liveText:    { ...Typography.labelSm, color: Colors.white, fontWeight: '700' },
  timer:       { ...Typography.labelLg, color: Colors.white },
  banner:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: 'rgba(0,0,0,0.25)' },
  bannerText:  { ...Typography.bodySm, color: Colors.white, flex: 1 },
  bannerBtn:   { paddingHorizontal: Spacing.sm, height: 30, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  bannerBtnText:{ ...Typography.labelSm, color: Colors.white, fontWeight: '700' },
  selfPreview: { position: 'absolute', top: 96, right: Spacing.containerMargin, width: 84, height: 116, borderRadius: Radius.lg, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  selfText:    { ...Typography.labelMd, color: Colors.white },
  joinRow:     { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.sm },
  endActions:  { flexDirection: 'row', justifyContent: 'center', gap: Spacing.lg },
  linkBtn:     { alignItems: 'center', paddingVertical: Spacing.sm },
  linkText:    { ...Typography.labelMd, color: Colors.white, textDecorationLine: 'underline' },
  quickRow:    { flexDirection: 'row', justifyContent: 'center', gap: Spacing.md, paddingBottom: Spacing.md },
  quickBtn:    { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  // sheet
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  sheetBtn:    { marginTop: Spacing.sm },
  summaryBody: { gap: 2 },
  summaryRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  summaryLabel:{ ...Typography.bodyMd, color: Colors.onSurfaceVariant, textTransform: 'capitalize' },
  summaryValue:{ ...Typography.labelMd, color: Colors.onSurface, textTransform: 'capitalize' },
  feedbackStars:{ alignItems: 'center', marginBottom: Spacing.md },
  input:       { minHeight: 80, borderRadius: Radius.lg, padding: Spacing.md, backgroundColor: Colors.surfaceContainerLow, ...Typography.bodyMd, color: Colors.onSurface, marginTop: Spacing.sm, textAlignVertical: 'top' },
  toggleLine:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm },
  toggleLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  toggleTrack: { width: 48, height: 28, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, padding: 2, justifyContent: 'center' },
  toggleTrackOn:{ backgroundColor: Colors.primary },
  toggleThumb: { width: 24, height: 24, borderRadius: Radius.full, backgroundColor: Colors.white },
  toggleThumbOn:{ alignSelf: 'flex-end' },
});
