import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Send, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useConsultThread, useSendConsultMessage } from '@/features/health/pharmacy/hooks';
import { relativeTime } from '@/features/health/constants/health.constants';

export default function PharmacistConsultScreen() {
  const { data: messages, isLoading, isError, refetch } = useConsultThread();
  const send = useSendConsultMessage();
  const [text, setText] = useState('');

  const onSend = () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    send.mutate(body);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Ask a pharmacist" subtitle="HealthPlus · Pharm. Grace E." />

      <View style={styles.banner}>
        <ShieldCheck size={13} color={Colors.teal} strokeWidth={2} />
        <Text style={styles.bannerText}>Licensed pharmacist. Not a substitute for emergency care.</Text>
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading chat…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load chat" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
          <FlatList
            data={messages ?? []}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={[styles.bubbleRow, item.fromPharmacist ? styles.left : styles.right]}>
                <View style={[styles.bubble, item.fromPharmacist ? styles.bubbleIn : styles.bubbleOut]}>
                  <Text style={[styles.body, !item.fromPharmacist && styles.bodyOut]}>{item.body}</Text>
                  <Text style={[styles.time, !item.fromPharmacist && styles.timeOut]}>{relativeTime(item.at)}</Text>
                </View>
              </View>
            )}
            ListEmptyComponent={<StateView kind="empty" compact icon="MessageCircle" title="Start the conversation" message="Ask about dosage, interactions and more." />}
          />

          <View style={styles.inputBar}>
            <TextInput
              style={styles.input}
              placeholder="Type a message…"
              placeholderTextColor={Colors.outline}
              value={text}
              onChangeText={setText}
              multiline
            />
            <Pressable style={[styles.sendBtn, !text.trim() && styles.sendDisabled]} onPress={onSend} disabled={!text.trim()}>
              <Send size={18} color={Colors.onPrimary} strokeWidth={2} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 7,
  },
  bannerText: { ...Typography.caption, color: Colors.tertiaryContainer, flex: 1 },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row' },
  left: { justifyContent: 'flex-start' },
  right: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', borderRadius: Radius.lg, padding: Spacing.sm + 2, gap: 3 },
  bubbleIn: { backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.outlineVariant },
  bubbleOut: { backgroundColor: Colors.primary },
  body: { ...Typography.bodyMd, color: Colors.onSurface },
  bodyOut: { color: Colors.onPrimary },
  time: { ...Typography.caption, color: Colors.onSurfaceVariant },
  timeOut: { color: Colors.inverseOnSurface },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
  input: {
    flex: 1,
    ...Typography.bodyMd,
    color: Colors.onSurface,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    maxHeight: 110,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.5 },
});
