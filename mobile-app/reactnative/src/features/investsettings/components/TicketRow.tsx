import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight, MessagesSquare } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StatusChip from './StatusChip';
import type { SupportTicket } from '../types/settings.types';
import { relativeTime } from './format';

interface Props {
  ticket: SupportTicket;
  onPress: () => void;
}

export default function TicketRow({ ticket, onPress }: Props) {
  const lastMessage = ticket.messages[ticket.messages.length - 1];
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.iconBox}>
        <MessagesSquare size={20} color={Colors.primary} strokeWidth={1.8} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.subject} numberOfLines={1}>{ticket.subject}</Text>
        {lastMessage ? (
          <Text style={styles.preview} numberOfLines={1}>
            {lastMessage.from === 'agent' ? 'Support: ' : 'You: '}{lastMessage.body}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <StatusChip status={ticket.status} />
          <Text style={styles.meta}>Updated {relativeTime(lastMessage?.at ?? ticket.createdAt)}</Text>
        </View>
      </View>
      <ChevronRight size={16} color={Colors.outline} strokeWidth={1.8} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  pressed: { backgroundColor: Colors.surfaceContainerLow },
  iconBox: {
    width: 40, height: 40, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  flex: { flex: 1 },
  subject: { ...Typography.labelLg, color: Colors.onSurface },
  preview: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
