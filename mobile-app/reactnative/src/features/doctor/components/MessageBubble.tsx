import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Paperclip } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { ChatMessage } from '@/types/doctor';

interface Props {
  message: ChatMessage;
}

// New component: a directional chat bubble keyed off ChatMessage.author. The
// telemedicine consult room inlines a private bubble shape, but there is no
// shared, reusable bubble component, and none accept the doctor ChatMessage type.
export default function MessageBubble({ message }: Props) {
  const mine = message.author === 'doctor';
  const time = new Date(message.createdAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!!message.attachmentName && (
          <View style={styles.attachment}>
            <Paperclip size={14} color={mine ? Colors.onPrimary : Colors.primary} strokeWidth={2} />
            <Text style={[styles.attachmentName, mine && styles.textMine]} numberOfLines={1}>{message.attachmentName}</Text>
          </View>
        )}
        {!!message.body && (
          <Text style={[styles.body, mine && styles.textMine]}>{message.body}</Text>
        )}
        <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>{time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row:           { width: '100%', flexDirection: 'row' },
  rowMine:       { justifyContent: 'flex-end' },
  rowTheirs:     { justifyContent: 'flex-start' },
  bubble:        { maxWidth: '82%', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.lg, gap: 4 },
  bubbleMine:    { backgroundColor: Colors.primary, borderBottomRightRadius: Radius.sm },
  bubbleTheirs:  { backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, borderBottomLeftRadius: Radius.sm },
  body:          { ...Typography.bodyMd, color: Colors.onSurface },
  textMine:      { color: Colors.onPrimary },
  attachment:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  attachmentName:{ ...Typography.labelSm, color: Colors.primary, flexShrink: 1 },
  time:          { ...Typography.caption, alignSelf: 'flex-end' },
  timeMine:      { color: 'rgba(255,255,255,0.75)' },
  timeTheirs:    { color: Colors.onSurfaceVariant },
});
