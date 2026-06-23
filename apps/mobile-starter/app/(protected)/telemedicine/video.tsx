// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, SafeAreaView, Modal,
  TextInput, ScrollView, Animated,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const C = {
  primary: '#059669',
  primaryContainer: '#d1fae5',
  secondary: '#0EA5E9',
  bg: '#0a0a0a',
  surface: '#1a1a1a',
  surfaceAlt: '#242424',
  text: '#FFFFFF',
  textMuted: 'rgba(255,255,255,0.6)',
  border: 'rgba(255,255,255,0.12)',
};

export default function VideoConsultation() {
  const router = useRouter();
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatMsg, setChatMsg] = useState('');
  const [messages, setMessages] = useState([
    { id: '1', from: 'doctor', text: 'Good afternoon! How are you feeling today?', time: '12:43' },
    { id: '2', from: 'patient', text: 'I have been experiencing chest pains on and off.', time: '12:44' },
  ]);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const sendMessage = () => {
    if (!chatMsg.trim()) return;
    setMessages((prev) => [...prev, { id: Date.now().toString(), from: 'patient', text: chatMsg.trim(), time: formatTime(elapsed) }]);
    setChatMsg('');
  };

  const handleEndCall = () => {
    router.back();
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      {/* Doctor video (full screen placeholder) */}
      <View style={s.mainVideo}>
        {isVideoOff ? (
          <View style={s.videoOffPlaceholder}>
            <Ionicons name="videocam-off" size={40} color={C.textMuted} />
            <Text style={s.videoOffText}>Video is off</Text>
          </View>
        ) : (
          <View style={s.doctorVideoPlaceholder}>
            <View style={s.doctorAvatarLarge}>
              <Ionicons name="person" size={64} color={C.primary} />
            </View>
          </View>
        )}

        {/* Top overlay — LIVE badge + connection status */}
        <View style={s.topOverlay}>
          <View style={s.liveBadge}>
            <View style={s.liveDot} />
            <Text style={s.liveText}>LIVE {formatTime(elapsed)}</Text>
          </View>
          <View style={s.connectionBadge}>
            <Ionicons name="cellular" size={12} color="#4ade80" />
            <Text style={s.connectionText}>Stable Connection</Text>
          </View>
        </View>

        {/* Doctor info overlay */}
        <View style={s.doctorOverlay}>
          <Text style={s.doctorName}>Dr. Adebayo Chen</Text>
          <View style={s.doctorMeta}>
            <Text style={s.doctorSpecialty}>Cardiologist</Text>
            <View style={s.hmoBadge}>
              <Ionicons name="shield-checkmark" size={10} color={C.primary} />
              <Text style={s.hmoText}>HMO Verified</Text>
            </View>
          </View>
        </View>

        {/* Self-view PiP */}
        <View style={s.selfView}>
          <View style={s.selfViewInner}>
            <Ionicons name="person" size={22} color={C.textMuted} />
          </View>
          <Text style={s.selfViewLabel}>You</Text>
        </View>
      </View>

      {/* Shared document notification */}
      <View style={s.docNotification}>
        <Ionicons name="document-text" size={18} color={C.secondary} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={s.docTitle}>Medical Record shared</Text>
          <Text style={s.docFile}>Prescription_Aug24.pdf</Text>
        </View>
        <Pressable style={s.viewBtn}>
          <Text style={s.viewBtnText}>View</Text>
        </Pressable>
      </View>

      {/* Controls */}
      <View style={s.controls}>
        <ControlBtn icon="camera-reverse-outline" label="Flip" onPress={() => {}} />
        <ControlBtn
          icon={isMuted ? 'mic-off' : 'mic-outline'}
          label={isMuted ? 'Unmute' : 'Mute'}
          active={isMuted}
          onPress={() => setIsMuted((v) => !v)}
        />
        <ControlBtn
          icon={isVideoOff ? 'videocam-off-outline' : 'videocam-outline'}
          label="Video"
          active={isVideoOff}
          onPress={() => setIsVideoOff((v) => !v)}
        />
        <Pressable style={s.chatBtn} onPress={() => setShowChat(true)}>
          <View style={s.chatIconBox}>
            <Ionicons name="chatbubble-outline" size={22} color={C.text} />
            <View style={s.chatBadge}><Text style={s.chatBadgeText}>2</Text></View>
          </View>
          <Text style={s.ctrlLabel}>Chat</Text>
        </Pressable>
        <ControlBtn icon="ellipsis-horizontal" label="More" onPress={() => {}} />
        <Pressable style={s.endCallBtn} onPress={handleEndCall}>
          <Ionicons name="call" size={24} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          <Text style={s.endCallLabel}>End</Text>
        </Pressable>
      </View>

      {/* Chat modal */}
      <Modal visible={showChat} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowChat(false)}>
        <SafeAreaView style={s.chatModal} edges={['top', 'bottom']}>
          <View style={s.chatHeader}>
            <Text style={s.chatTitle}>Consultation Chat</Text>
            <Pressable onPress={() => setShowChat(false)}>
              <Ionicons name="close" size={24} color="#0F172A" />
            </Pressable>
          </View>
          <ScrollView style={s.chatMessages} contentContainerStyle={{ padding: 16, gap: 10 }}>
            {messages.map((msg) => (
              <View key={msg.id} style={[s.msgRow, msg.from === 'patient' && s.msgRowSelf]}>
                <View style={[s.msgBubble, msg.from === 'patient' ? s.msgBubbleSelf : s.msgBubbleDoctor]}>
                  <Text style={[s.msgText, msg.from === 'patient' && { color: '#fff' }]}>{msg.text}</Text>
                </View>
                <Text style={s.msgTime}>{msg.time}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={s.chatInputRow}>
            <TextInput
              style={s.chatInput}
              placeholder="Type a message…"
              value={chatMsg}
              onChangeText={setChatMsg}
              multiline
            />
            <Pressable style={s.sendBtn} onPress={sendMessage}>
              <Ionicons name="send" size={18} color="#fff" />
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function ControlBtn({ icon, label, onPress, active = false }: {
  icon: string; label: string; onPress: () => void; active?: boolean;
}) {
  return (
    <Pressable style={s.ctrlBtn} onPress={onPress}>
      <View style={[s.ctrlIconBox, active && s.ctrlIconBoxActive]}>
        <Ionicons name={icon as any} size={22} color={active ? '#fff' : C.text} />
      </View>
      <Text style={s.ctrlLabel}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  mainVideo: { flex: 1, position: 'relative', backgroundColor: '#0d1117' },
  doctorVideoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#101a13' },
  doctorAvatarLarge: { width: 120, height: 120, borderRadius: 60, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  videoOffPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  videoOffText: { color: C.textMuted, fontSize: 16 },
  topOverlay: { position: 'absolute', top: 12, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  liveText: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  connectionBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100 },
  connectionText: { color: '#4ade80', fontSize: 12, fontWeight: '600' },
  doctorOverlay: { position: 'absolute', bottom: 12, left: 16 },
  doctorName: { color: '#fff', fontSize: 18, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  doctorMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  doctorSpecialty: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  hmoBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.primaryContainer, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 100 },
  hmoText: { fontSize: 10, color: C.primary, fontWeight: '700' },
  selfView: { position: 'absolute', top: 12, right: 16, alignItems: 'center' },
  selfViewInner: { width: 80, height: 100, borderRadius: 12, backgroundColor: C.surfaceAlt, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  selfViewLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 4 },
  docNotification: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, padding: 14, borderTopWidth: 1, borderTopColor: C.border },
  docTitle: { color: C.text, fontSize: 13, fontWeight: '600' },
  docFile: { color: C.textMuted, fontSize: 12, marginTop: 1 },
  viewBtn: { backgroundColor: C.secondary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  viewBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', backgroundColor: C.surface, paddingVertical: 16, paddingHorizontal: 8 },
  ctrlBtn: { alignItems: 'center', gap: 4 },
  ctrlIconBox: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  ctrlIconBoxActive: { backgroundColor: '#374151' },
  ctrlLabel: { color: C.textMuted, fontSize: 11 },
  chatBtn: { alignItems: 'center', gap: 4 },
  chatIconBox: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  chatBadge: { position: 'absolute', top: -2, right: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center' },
  chatBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  endCallBtn: { alignItems: 'center', gap: 4 },
  endCallLabel: { color: '#ef4444', fontSize: 11, fontWeight: '600' },
  chatModal: { flex: 1, backgroundColor: '#fff' },
  chatHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  chatTitle: { fontSize: 17, fontWeight: '700', color: '#0F172A' },
  chatMessages: { flex: 1 },
  msgRow: { alignItems: 'flex-start' },
  msgRowSelf: { alignItems: 'flex-end' },
  msgBubble: { maxWidth: '75%', padding: 12, borderRadius: 16 },
  msgBubbleDoctor: { backgroundColor: '#F1F5F9', borderBottomLeftRadius: 4 },
  msgBubbleSelf: { backgroundColor: C.primary, borderBottomRightRadius: 4 },
  msgText: { fontSize: 14, color: '#0F172A', lineHeight: 20 },
  msgTime: { fontSize: 10, color: '#94a3b8', marginTop: 4 },
  chatInputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0', gap: 10 },
  chatInput: { flex: 1, backgroundColor: '#F1F5F9', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, maxHeight: 100 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
});
