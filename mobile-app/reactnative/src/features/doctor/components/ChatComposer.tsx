import React, { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, Platform } from 'react-native';
import { Send, Paperclip } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  onSend:      (body: string) => void;
  sending?:    boolean;
  onAttach?:   () => void;
  placeholder?: string;
}

// New component: a sticky chat input bar with grow-to-multiline text + send.
// TextInputField is a labelled single-line form field and PrimaryButton is a
// full-height CTA; neither fits an inline composer, so this is genuinely new.
export default function ChatComposer({ onSend, sending = false, onAttach, placeholder = 'Type a message' }: Props) {
  const [value, setValue] = useState('');

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || sending) return;
    onSend(trimmed);
    setValue('');
  };

  return (
    <View style={styles.bar}>
      {onAttach && (
        <Pressable
          onPress={onAttach}
          style={styles.attachBtn}
          accessibilityRole="button"
          accessibilityLabel="Attach a file"
          hitSlop={8}
        >
          <Paperclip size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </Pressable>
      )}
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={Colors.outline}
        value={value}
        onChangeText={setValue}
        multiline
      />
      <Pressable
        onPress={handleSend}
        disabled={!value.trim() || sending}
        style={[styles.sendBtn, (!value.trim() || sending) && styles.sendBtnDisabled]}
        accessibilityRole="button"
        accessibilityLabel="Send message"
      >
        <Send size={18} color={Colors.onPrimary} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar:             { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Platform.OS === 'ios' ? Spacing.sm : Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, backgroundColor: Colors.background },
  attachBtn:       { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  input:           { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingTop: Platform.OS === 'ios' ? 12 : 8, paddingBottom: Platform.OS === 'ios' ? 12 : 8, backgroundColor: Colors.surfaceContainerLow, ...Typography.bodyMd, color: Colors.onSurface },
  sendBtn:         { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
});
