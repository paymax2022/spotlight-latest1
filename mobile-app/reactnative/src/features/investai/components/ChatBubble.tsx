import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import DisclaimerNote from './DisclaimerNote';
import type { ChatMessage } from '../types/ai.types';

interface Props {
  message: ChatMessage;
}

/**
 * One chat turn. User turns are right-aligned on a filled bubble; assistant
 * turns are left-aligned with an assistant glyph and, when flagged, a compact
 * disclaimer footnote (every educational answer + every refusal carries one —
 * docs/crypto/modules.md → Guardrails).
 */
export default function ChatBubble({ message }: Props) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{message.text}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.assistantRow}>
      <View style={styles.avatar}>
        <Sparkles size={16} color={Colors.primary} strokeWidth={2} />
      </View>
      <View style={styles.assistantCol}>
        <View style={styles.assistantBubble}>
          <Text style={styles.assistantText}>{message.text}</Text>
        </View>
        {message.disclaimer ? <DisclaimerNote compact /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  userRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: Spacing.md },
  userBubble: {
    maxWidth: '82%',
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    borderBottomRightRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  userText: { ...Typography.bodyMd, color: Colors.onPrimary },

  assistantRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginBottom: Spacing.md },
  avatar: {
    width: 32, height: 32, borderRadius: Radius.full,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  assistantCol: { flex: 1, maxWidth: '88%' },
  assistantBubble: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderTopLeftRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  assistantText: { ...Typography.bodyMd, color: Colors.onSurface, lineHeight: 24 },
});
