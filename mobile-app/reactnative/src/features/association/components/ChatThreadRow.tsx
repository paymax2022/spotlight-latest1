import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { BellOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { relativeTime } from '../utils/associationFormatters';
import { CHAT_SCOPE_ICON } from '../constants/chat.constants';
import type { ChatThreadSummary } from '../types/chat.types';

interface Props {
  thread: ChatThreadSummary;
  onPress: () => void;
}

export default function ChatThreadRow({ thread: t, onPress }: Props) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[CHAT_SCOPE_ICON[t.scope]] ?? Icons.MessageCircle;
  const hasUnread = t.unreadCount > 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${t.title}${hasUnread ? `, ${t.unreadCount} unread` : ''}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.avatar}>
        <Icon size={20} color={Colors.primary} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.title} numberOfLines={1}>{t.title}</Text>
          <Text style={styles.time}>{relativeTime(t.lastAt)}</Text>
        </View>
        <View style={styles.bottomRow}>
          <Text style={[styles.preview, hasUnread && styles.previewUnread]} numberOfLines={1}>{t.lastMessage}</Text>
          {t.muted ? <BellOff size={13} color={Colors.outline} strokeWidth={2} /> : null}
          {hasUnread ? (
            <View style={styles.badge}><Text style={styles.badgeText}>{t.unreadCount}</Text></View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  pressed: { opacity: 0.7 },
  avatar: { width: 48, height: 48, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  time: { ...Typography.caption, color: Colors.outline },
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  preview: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  previewUnread: { color: Colors.onSurface, fontWeight: '600' as const },
  badge: { minWidth: 20, height: 20, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { ...Typography.caption, color: Colors.onPrimary, fontWeight: '700' as const },
});
