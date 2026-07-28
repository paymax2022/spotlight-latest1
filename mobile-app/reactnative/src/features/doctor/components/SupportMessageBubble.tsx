import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Paperclip } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { SupportMessage } from '@/types/doctor.batch7';

interface Props {
  message: SupportMessage;
}

// New component: a support-thread bubble. The Phase 1 MessageBubble is typed to
// the doctor/patient ChatMessage union; the support thread adds `agent` and a
// centered `system` notice, so a dedicated bubble that understands the
// SupportMessageAuthor union is justified (reuses the same bubble layout tokens).
export default function SupportMessageBubble({ message }: Props) {
  const time = new Date(message.createdAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });

  if (message.author === 'system') {
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemText}>{message.body}</Text>
      </View>
    );
  }

  const mine = message.author === 'doctor';
  const authorLabel = message.author === 'agent' ? 'Support' : undefined;
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!!authorLabel && <Text style={styles.author}>{authorLabel}</Text>}
        {!!message.attachment && (
          <View style={styles.attachment}>
            <Paperclip size={14} color={mine ? Colors.onPrimary : Colors.primary} strokeWidth={2} />
            <Text style={[styles.attachmentName, mine && styles.textMine]} numberOfLines={1}>{message.attachment.fileName}</Text>
          </View>
        )}
        {!!message.body && <Text style={[styles.body, mine && styles.textMine]}>{message.body}</Text>}
        <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>{time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row:            { width: '100%', flexDirection: 'row' },
  rowMine:        { justifyContent: 'flex-end' },
  rowTheirs:      { justifyContent: 'flex-start' },
  bubble:         { maxWidth: '82%', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.lg, gap: 4 },
  bubbleMine:     { backgroundColor: Colors.primary, borderBottomRightRadius: Radius.sm },
  bubbleTheirs:   { backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, borderBottomLeftRadius: Radius.sm },
  author:         { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' },
  body:           { ...Typography.bodyMd, color: Colors.onSurface },
  textMine:       { color: Colors.onPrimary },
  attachment:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  attachmentName: { ...Typography.labelSm, color: Colors.primary, flexShrink: 1 },
  time:           { ...Typography.caption, alignSelf: 'flex-end' },
  timeMine:       { color: 'rgba(255,255,255,0.75)' },
  timeTheirs:     { color: Colors.onSurfaceVariant },
  systemRow:      { alignItems: 'center', paddingVertical: Spacing.xs },
  systemText:     { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center', backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.full, overflow: 'hidden' },
});
