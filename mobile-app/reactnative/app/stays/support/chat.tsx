import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Send } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import { useTrip } from '@/features/stays/trips';

interface Msg { id: string; from: 'guest' | 'property'; text: string; time: string }

const SEED: Msg[] = [
  { id: 'm1', from: 'property', text: 'Hello! Thank you for booking with us. How can we help with your stay?', time: '09:12' },
  { id: 'm2', from: 'guest', text: 'Hi, can I request an early check-in around 11am?', time: '09:14' },
  { id: 'm3', from: 'property', text: 'We will do our best to have your room ready by 11am. We will confirm on the day.', time: '09:15' },
];

export default function ChatWithPropertyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id ?? '');
  const [messages, setMessages] = useState<Msg[]>(SEED);
  const [text, setText] = useState('');

  function send() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const now = new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
    setMessages((m) => [...m, { id: `g_${Date.now()}`, from: 'guest', text: trimmed, time: now }]);
    setText('');
    // Mock auto-reply from the property.
    setTimeout(() => {
      setMessages((m) => [...m, { id: `p_${Date.now()}`, from: 'property', text: 'Thanks for your message — our front desk will respond shortly.', time: now }]);
    }, 900);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={trip.data?.propertyName ?? 'Chat with property'} subtitle="In-app messaging" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const mine = item.from === 'guest';
            return (
              <View style={[styles.bubbleWrap, mine ? styles.mineWrap : styles.theirsWrap]}>
                <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                  <Text style={[styles.msgText, mine && styles.msgTextMine]}>{item.text}</Text>
                </View>
                <Text style={styles.time}>{item.time}</Text>
              </View>
            );
          }}
        />
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Type a message…"
            placeholderTextColor={Colors.onSurfaceVariant}
            multiline
          />
          <Pressable style={[styles.sendBtn, !text.trim() && styles.sendBtnDim]} onPress={send} disabled={!text.trim()}>
            <Send size={20} color={Colors.onPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  bubbleWrap: { maxWidth: '82%' },
  mineWrap: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  theirsWrap: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: Radius.lg, padding: Spacing.md },
  mine: { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: Colors.surfaceContainerLow, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: Colors.outlineVariant },
  msgText: { ...Typography.bodyMd, color: Colors.onSurface },
  msgTextMine: { color: Colors.onPrimary },
  time: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  input: { flex: 1, maxHeight: 120, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, ...Typography.bodyMd, color: Colors.onSurface },
  sendBtn: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDim: { opacity: 0.5 },
});
