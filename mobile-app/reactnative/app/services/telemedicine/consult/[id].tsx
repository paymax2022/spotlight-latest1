import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, MessageCircle, Send, NotebookPen,
} from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { getAppointment, DEMO_APPOINTMENTS } from '@/api/telemedicine.api';
import { DoctorAvatar } from '@/features/telemedicine/components';

interface ChatMessage { id: string; from: 'me' | 'doctor'; text: string; }

const SEED_CHAT: ChatMessage[] = [
  { id: 'm1', from: 'doctor', text: "Hello! I'm here. How are you feeling today?" },
];

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

  const { data: appt } = useQuery({
    queryKey: ['tele-appointment', id],
    queryFn:  () => getAppointment(String(id)),
    placeholderData: DEMO_APPOINTMENTS.find((a) => a.id === id) ?? DEMO_APPOINTMENTS[0],
  });

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const send = () => {
    if (!draft.trim()) return;
    setChat((c) => [...c, { id: `m${c.length + 1}`, from: 'me', text: draft.trim() }]);
    setDraft('');
  };

  const endCall = () => {
    router.replace(`/services/telemedicine/appointment/${id}/summary`);
  };

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  const doctor = appt?.doctor;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <LinearGradient colors={['#1A0050', '#340075']} style={StyleSheet.absoluteFill} />

      {/* Top status */}
      <View style={styles.topBar}>
        <View style={styles.liveTag}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
        <Text style={styles.timer}>{mm}:{ss}</Text>
      </View>

      {/* Doctor stage */}
      <View style={styles.stage}>
        {doctor && <DoctorAvatar initials={doctor.initials} color={doctor.avatarColor} size={120} />}
        <Text style={styles.docName}>{doctor?.name}</Text>
        <Text style={styles.docSpec}>{doctor?.specialties.join(' • ')}</Text>
        <View style={styles.connBadge}>
          <Text style={styles.connText}>Connected · {camOn ? 'Video on' : 'Video off'}</Text>
        </View>

        {/* Self preview */}
        <View style={styles.selfPreview}>
          {camOn ? <Text style={styles.selfText}>You</Text> : <VideoOff size={20} color={Colors.white} strokeWidth={2} />}
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
