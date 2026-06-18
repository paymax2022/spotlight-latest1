// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

interface Message { id: string; text: string; sender: string; initials: string; timestamp: string; mine: boolean; }

const INITIAL_MESSAGES: Message[] = [
  { id: '1', text: 'Good morning everyone. The meeting will start in 5 minutes.', sender: 'Secretary', initials: 'SC', timestamp: '9:55 AM', mine: false },
  { id: '2', text: 'Thanks! I am joining now.', sender: 'You', initials: 'YO', timestamp: '9:57 AM', mine: true },
  { id: '3', text: 'Please ensure you have the agenda document ready.', sender: 'Chairman', initials: 'CH', timestamp: '9:58 AM', mine: false },
];

export default function MeetingChat() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [text, setText] = useState('');
  const listRef = useRef<FlatList>(null);

  const sendMessage = () => {
    if (!text.trim()) return;
    const newMsg: Message = {
      id: Date.now().toString(),
      text: text.trim(),
      sender: 'You',
      initials: 'YO',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      mine: true,
    };
    setMessages(prev => [...prev, newMsg]);
    setText('');
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Meeting Discussion</Text>
        <View style={{ width: 38 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={[styles.bubbleWrap, item.mine && styles.bubbleWrapMine]}>
              {!item.mine ? (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.initials}</Text>
                </View>
              ) : null}
              <View style={[styles.bubble, item.mine ? styles.bubbleMine : styles.bubbleOther]}>
                {!item.mine ? <Text style={styles.senderName}>{item.sender}</Text> : null}
                <Text style={[styles.bubbleText, item.mine && { color: '#fff' }]}>{item.text}</Text>
                <Text style={[styles.timestamp, item.mine && { color: 'rgba(255,255,255,0.7)' }]}>{item.timestamp}</Text>
              </View>
            </View>
          )}
        />

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            placeholderTextColor={colors.neutral.placeholder}
            value={text}
            onChangeText={setText}
            multiline
          />
          <Pressable style={[styles.sendBtn, !text.trim() && { opacity: 0.5 }]} onPress={sendMessage} disabled={!text.trim()}>
            <Ionicons name="send" size={20} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  listContent: { padding: 16, gap: 10, paddingBottom: 10 },
  bubbleWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleWrapMine: { flexDirection: 'row-reverse' },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary.DEFAULT + '22', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 12, fontWeight: '700', color: colors.primary.DEFAULT },
  bubble: { maxWidth: '75%', borderRadius: 16, padding: 12, gap: 2 },
  bubbleMine: { backgroundColor: colors.primary.DEFAULT, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.neutral.surface, borderBottomLeftRadius: 4 },
  senderName: { fontSize: 11, fontWeight: '700', color: colors.primary.DEFAULT, marginBottom: 2 },
  bubbleText: { fontSize: 14, color: colors.neutral.text, lineHeight: 20 },
  timestamp: { fontSize: 11, color: colors.neutral.textMuted, alignSelf: 'flex-end' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 12, backgroundColor: colors.neutral.surface, borderTopWidth: 1, borderTopColor: colors.neutral.border },
  input: { flex: 1, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, color: colors.neutral.text, maxHeight: 100 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center' },
});
