import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, MessageCircle, NotebookPen, ClipboardList,
} from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { getAppointment, PLACEHOLDER_APPOINTMENTS } from '@/api/telemedicine.api';
import { DoctorAvatar } from '@/features/telemedicine/components';
import { useLocalMedia } from '@/features/telemedicine/useLocalMedia';
import SelfVideo from '@/features/telemedicine/SelfVideo';
import { useApptIntake } from '@/features/health/hooks';
import PrimaryButton from '@/components/PrimaryButton';

// Designated consult length. The appointment model carries no per-booking
// duration, so the window is anchored to the booked slot start instead.
const SESSION_SECONDS = 20 * 60;

/** Session end (epoch ms): slot start + length once the slot has begun, else entry + length. */
function sessionEndsAt(scheduledAt: string | undefined, enteredAt: number): number {
  const start = scheduledAt ? Date.parse(scheduledAt) : NaN;
  const anchor = Number.isFinite(start) && start <= enteredAt ? start : enteredAt;
  return anchor + SESSION_SECONDS * 1000;
}

export default function ConsultRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState('');
  const [enteredAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [ended, setEnded] = useState(false);

  const { data: appt } = useQuery({
    queryKey: ['tele-appointment', id],
    queryFn:  () => getAppointment(String(id)),
    placeholderData: PLACEHOLDER_APPOINTMENTS?.find((a) => a.id === id) ?? PLACEHOLDER_APPOINTMENTS?.[0],
  });

  // PRD §1 structural gate: the consult cannot start until intake is SUBMITTED.
  // Fail-safe — anything other than an explicit SUBMITTED blocks the room.
  const intakeQ = useApptIntake(String(id));
  const intakeReady = intakeQ.data?.intake.status === 'SUBMITTED';

  // Real camera + mic (browser getUserMedia on web; no-op placeholder on native).
  // Only requested once the patient is actually in the room.
  const media = useLocalMedia(intakeReady && !ended);

  // Session clock: anchored to the appointment slot, so a reload does not reset it.
  const endsAt = useMemo(() => sessionEndsAt(appt?.scheduledAt, enteredAt), [appt?.scheduledAt, enteredAt]);
  useEffect(() => {
    if (!intakeReady || ended) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [intakeReady, ended]);
  const remaining = Math.min(SESSION_SECONDS, Math.max(0, Math.ceil((endsAt - now) / 1000)));

  // Reaching the designated end stops the clock, releases the camera/mic, and
  // auto-ends the call after a short grace so the patient sees it ended.
  useEffect(() => {
    if (intakeReady && appt && remaining <= 0 && !ended) setEnded(true);
  }, [intakeReady, appt, remaining, ended]);

  useEffect(() => {
    if (!ended) return;
    media.stop();
    const t = setTimeout(() => router.replace(`/services/telemedicine/appointment/${id}/summary`), 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended]);

  // Mirror the mic/camera buttons onto the real media tracks.
  useEffect(() => { media.setAudioEnabled(micOn); }, [micOn, media]);
  useEffect(() => { media.setVideoEnabled(camOn); }, [camOn, media]);

  // Leaving ends only the patient's side. POST /appointments/:id/complete is
  // doctor-only (it settles the escrowed fee), so the patient never calls it.
  const endCall = () => {
    media.stop();
    router.replace(`/services/telemedicine/appointment/${id}/summary`);
  };

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const doctor = appt?.doctor;

  // Intake gate — block the live room until the patient has submitted intake.
  if (!intakeReady) {
    const loading = intakeQ.isLoading;
    return (
      <SafeAreaView style={styles.gateSafe} edges={['top', 'bottom']}>
        <View style={styles.gateWrap}>
          <View style={styles.gateIcon}>
            <ClipboardList size={40} color={Colors.primary} strokeWidth={1.8} />
          </View>
          <Text style={styles.gateTitle}>
            {loading ? 'Checking your intake…' : 'Complete your health intake first'}
          </Text>
          <Text style={styles.gateBody}>
            {loading
              ? 'One moment.'
              : 'Your consultation can’t start until you’ve shared your health details with the doctor. It only takes a minute and helps your doctor prepare.'}
          </Text>
          {!loading && (
            <View style={styles.gateActions}>
              <PrimaryButton
                label="Add your health details"
                onPress={() => router.replace(`/services/telemedicine/appointment/${id}/intake`)}
              />
              <PrimaryButton
                label="Back to appointment"
                variant="ghost"
                onPress={() => router.replace(`/services/telemedicine/appointment/${id}`)}
              />
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <LinearGradient colors={['#1A0050', '#340075']} style={StyleSheet.absoluteFill} />

      {/* Top status */}
      <View style={styles.topBar}>
        <View style={[styles.liveTag, ended && styles.endedTag]}>
          <View style={[styles.liveDot, ended && styles.endedDot]} />
          <Text style={styles.liveText}>{ended ? 'ENDED' : 'LIVE'}</Text>
        </View>
        <Text style={styles.timer}>{ended ? 'Session ended' : `${mm}:${ss}`}</Text>
      </View>

      {/* Doctor stage */}
      <View style={styles.stage}>
        {doctor && <DoctorAvatar initials={doctor.initials} color={doctor.avatarColor} size={120} />}
        <Text style={styles.docName}>{doctor?.name}</Text>
        <Text style={styles.docSpec}>{doctor?.specialties.join(' • ')}</Text>
        {/* No RTC provider is wired yet, so there is no remote stream to show. */}
        <Text style={styles.docSpec}>Doctor video not connected</Text>
        <View style={styles.connBadge}>
          <Text style={styles.connText}>
            {ended
              ? 'Session ended'
              : media.status === 'denied'
                ? 'Camera & mic blocked — allow access'
                : media.status === 'requesting'
                  ? 'Starting camera…'
                  : `Your camera ${camOn ? 'on' : 'off'} · mic ${micOn ? 'on' : 'off'}`}
          </Text>
        </View>

        {/* Self preview — real local camera on web (getUserMedia) */}
        <View style={styles.selfPreview}>
          <SelfVideo stream={media.stream as MediaStream | null} camOn={camOn} />
        </View>
      </View>

      {/* Chat overlay */}
      {showChat && (
        <View style={styles.chatPanel}>
          <Text style={styles.panelTitle}>Chat</Text>
          {/* No patient-side consult chat endpoint exists yet; never echo unsent messages. */}
          <Text style={styles.bubbleText}>
            In-call chat isn’t available yet. Use My notes to keep track of anything you want to ask.
          </Text>
        </View>
      )}

      {/* Notes overlay */}
      {showNotes && (
        <View style={styles.chatPanel}>
          <Text style={styles.panelTitle}>My notes</Text>
          <TextInput
            style={styles.notesInput}
            placeholder="Jot down anything you want to remember"
            placeholderTextColor={Colors.outline}
            value={notes}
            onChangeText={setNotes}
            multiline
            textAlignVertical="top"
          />
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        <ControlBtn active={micOn} onPress={() => setMicOn((v) => !v)} On={Mic} Off={MicOff} />
        <ControlBtn active={camOn} onPress={() => setCamOn((v) => !v)} On={VideoIcon} Off={VideoOff} />
        <ControlBtn active={showChat} onPress={() => { setShowChat((v) => !v); setShowNotes(false); }} On={MessageCircle} Off={MessageCircle} />
        <ControlBtn active={showNotes} onPress={() => { setShowNotes((v) => !v); setShowChat(false); }} On={NotebookPen} Off={NotebookPen} />
        <Pressable style={styles.endBtn} onPress={endCall}>
          <PhoneOff size={24} color={Colors.white} strokeWidth={2} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function ControlBtn({ active, onPress, On, Off }: { active: boolean; onPress: () => void; On: typeof Mic; Off: typeof Mic }) {
  const Icon = active ? On : Off;
  return (
    <Pressable onPress={onPress} style={[styles.ctrl, !active && styles.ctrlOff]}>
      <Icon size={22} color={active ? Colors.white : Colors.onSurface} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: '#1A0050' },
  gateSafe:   { flex: 1, backgroundColor: Colors.background },
  gateWrap:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  gateIcon:   { width: 84, height: 84, borderRadius: 42, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  gateTitle:  { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  gateBody:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 22 },
  gateActions:{ alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.md },
  topBar:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md },
  liveTag:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 28, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.15)' },
  liveDot:    { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF5A5A' },
  // Applied ON TOP of liveTag/liveDot when the session has ended, so they only
  // override what changes: the badge dims and the recording-red dot goes neutral,
  // matching the LIVE -> ENDED label beside them. Both reuse white-overlay alphas
  // border) rather than introducing new values — constants/tokens.ts has no solid
  // muted token, only gradientMuted, which is a gradient for disabled surfaces.
  endedTag:   { backgroundColor: 'rgba(255,255,255,0.12)' },
  endedDot:   { backgroundColor: 'rgba(255,255,255,0.25)' },
  liveText:   { ...Typography.labelSm, color: Colors.white, fontWeight: '700' },
  timer:      { ...Typography.labelLg, color: Colors.white },
  stage:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  docName:    { ...Typography.headlineMd, color: Colors.white, marginTop: Spacing.md },
  docSpec:    { ...Typography.bodyMd, color: 'rgba(255,255,255,0.7)' },
  connBadge:  { marginTop: Spacing.sm, paddingHorizontal: Spacing.md, height: 32, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  connText:   { ...Typography.labelSm, color: 'rgba(255,255,255,0.85)' },
  selfPreview:{ position: 'absolute', top: 0, right: Spacing.containerMargin, width: 84, height: 116, borderRadius: Radius.lg, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  selfText:   { ...Typography.labelMd, color: Colors.white },
  chatPanel:  { marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md, padding: Spacing.md, borderRadius: Radius.xl, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
  panelTitle: { ...Typography.titleMd, color: Colors.onSurface },
  bubbleText: { ...Typography.bodySm, color: Colors.onSurface },
  notesInput: { minHeight: 110, borderRadius: Radius.lg, padding: Spacing.md, backgroundColor: Colors.surfaceContainerLow, ...Typography.bodyMd, color: Colors.onSurface },
  controls:   { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  ctrl:       { width: 56, height: 56, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  ctrlOff:    { backgroundColor: Colors.white },
  endBtn:     { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: '#E5484D', alignItems: 'center', justifyContent: 'center' },
});
