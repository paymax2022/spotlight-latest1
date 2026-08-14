import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, MessageCircle, Send, NotebookPen, ClipboardList,
} from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { getAppointment, DEMO_APPOINTMENTS } from '@/api/telemedicine.api';
import { DoctorAvatar } from '@/features/telemedicine/components';
import { useLocalMedia } from '@/features/telemedicine/useLocalMedia';
import SelfVideo from '@/features/telemedicine/SelfVideo';
import { useApptIntake } from '@/features/health/hooks';
import PrimaryButton from '@/components/PrimaryButton';

interface ChatMessage { id: string; from: 'me' | 'doctor'; text: string; }

const SEED_CHAT: ChatMessage[] = [
  { id: 'm1', from: 'doctor', text: "Hello! I'm here. How are you feeling today?" },
];

// Designated consult length. The session timer counts down from this and stops
// (and auto-ends the call) at 0. Kept here until the appointment model carries a
// per-booking duration.
const SESSION_SECONDS = 20 * 60;

export default function ConsultRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>(SEED_CHAT);
  const [draft, setDraft] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [ended, setEnded] = useState(false);

  const { data: appt } = useQuery({
    queryKey: ['tele-appointment', id],
    queryFn:  () => getAppointment(String(id)),
    placeholderData: DEMO_APPOINTMENTS.find((a) => a.id === id) ?? DEMO_APPOINTMENTS[0],
  });

  // PRD §1 structural gate: the consult cannot start until intake is SUBMITTED.
  // Fail-safe — anything other than an explicit SUBMITTED blocks the room.
  const intakeQ = useApptIntake(String(id));
  const intakeReady = intakeQ.data?.intake.status === 'SUBMITTED';

  // Real camera + mic (browser getUserMedia on web; no-op placeholder on native).
  // Only requested once the patient is actually in the room.
  const media = useLocalMedia(intakeReady && !ended);

  // Session clock: tick only while live, cap at the session length, and stop.
  useEffect(() => {
    if (!intakeReady || ended) return;
    const t = setInterval(() => setSeconds((s) => Math.min(s + 1, SESSION_SECONDS)), 1000);
    return () => clearInterval(t);
  }, [intakeReady, ended]);

  // Reaching the designated end stops the clock, releases the camera/mic, and
  // auto-ends the call after a short grace so the patient sees it ended.
  useEffect(() => {
    if (seconds >= SESSION_SECONDS && !ended) setEnded(true);
  }, [seconds, ended]);

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

  const send = () => {
    if (!draft.trim()) return;
    setChat((c) => [...c, { id: `m${c.length + 1}`, from: 'me', text: draft.trim() }]);
    setDraft('');
  };

  const endCall = () => {
    media.stop();
    router.replace(`/services/telemedicine/appointment/${id}/summary`);
  };

  // Countdown to the designated session end.
  const remaining = Math.max(0, SESSION_SECONDS - seconds);
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
          <ScrollView style={{ maxHeight: 180 }} contentContainerStyle={{ gap: Spacing.sm }}>
            {chat.map((m) => (
              <View key={m.id} style={[styles.bubble, m.from === 'me' ? styles.bubbleMe : styles.bubbleDoc]}>
                <Text style={[styles.bubbleText, m.from === 'me' && { color: Colors.white }]}>{m.text}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.chatInputRow}>
            <TextInput style={styles.chatInput} placeholder="Type a message" placeholderTextColor={Colors.outline} value={draft} onChangeText={setDraft} />
            <Pressable style={styles.sendBtn} onPress={send}><Send size={18} color={Colors.white} strokeWidth={2} /></Pressable>
          </View>
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
  bubble:     { maxWidth: '80%', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.lg },
  bubbleMe:   { alignSelf: 'flex-end', backgroundColor: Colors.primary },
  bubbleDoc:  { alignSelf: 'flex-start', backgroundColor: Colors.surfaceContainerLow },
  bubbleText: { ...Typography.bodySm, color: Colors.onSurface },
  chatInputRow:{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  chatInput:  { flex: 1, height: 46, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, backgroundColor: Colors.surfaceContainerLow, ...Typography.bodyMd, color: Colors.onSurface },
  sendBtn:    { width: 46, height: 46, borderRadius: Radius.lg, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  notesInput: { minHeight: 110, borderRadius: Radius.lg, padding: Spacing.md, backgroundColor: Colors.surfaceContainerLow, ...Typography.bodyMd, color: Colors.onSurface },
  controls:   { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  ctrl:       { width: 56, height: 56, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  ctrlOff:    { backgroundColor: Colors.white },
  endBtn:     { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: '#E5484D', alignItems: 'center', justifyContent: 'center' },
});
