import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { Pin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { ChatMessage } from '../types/chat.types';

interface Props {
  message: ChatMessage;
  showAuthor: boolean;          // show author name (group chats, first in a run)
  onReact?: (emoji: string) => void;
}

const QUICK = ['👍', '❤️'];

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
}

export default function MessageBubble({ message: m, showAuthor, onReact }: Props) {
  if (m.system) {
    return (
      <View style={styles.systemWrap}>
        <Text style={styles.systemText}>{m.body}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, m.mine ? styles.wrapMine : styles.wrapOther]}>
      {m.pinned ? (
        <View style={styles.pinRow}>
          <Pin size={11} color={Colors.gold} strokeWidth={2.2} />
          <Text style={styles.pinText}>Pinned</Text>
        </View>
      ) : null}
      <View style={[styles.bubble, m.mine ? styles.bubbleMine : styles.bubbleOther]}>
        {showAuthor && !m.mine ? (
          <Text style={styles.author}>
            {m.authorName}{m.authorRole ? ` · ${m.authorRole}` : ''}
          </Text>
        ) : null}
        {m.imageUrl ? <Image source={{ uri: m.imageUrl }} style={styles.image} /> : null}
        {m.body ? <Text style={[styles.body, m.mine && styles.bodyMine]}>{m.body}</Text> : null}
        <Text style={[styles.time, m.mine && styles.timeMine]}>{timeLabel(m.createdAt)}</Text>
      </View>

      {/* Reactions + quick-react */}
      <View style={[styles.reactRow, m.mine ? styles.reactRowMine : styles.reactRowOther]}>
        {m.reactions.map((r) => (
          <Pressable
            key={r.emoji}
            onPress={() => onReact?.(r.emoji)}
            style={[styles.reactChip, r.mine && styles.reactChipMine]}
            accessibilityRole="button"
            accessibilityLabel={`${r.emoji} ${r.count}`}
          >
            <Text style={styles.reactEmoji}>{r.emoji}</Text>
            <Text style={[styles.reactCount, r.mine && styles.reactCountMine]}>{r.count}</Text>
          </Pressable>
        ))}
        {onReact ? (
          QUICK.filter((e) => !m.reactions.some((r) => r.emoji === e)).map((e) => (
            <Pressable key={e} onPress={() => onReact(e)} style={styles.quickReact} hitSlop={4} accessibilityRole="button" accessibilityLabel={`React ${e}`}>
              <Text style={styles.quickEmoji}>{e}</Text>
            </Pressable>
          ))
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { maxWidth: '82%', marginVertical: 3 },
  wrapMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  wrapOther: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 2, marginHorizontal: 4 },
  pinText: { ...Typography.caption, color: Colors.gold, fontWeight: '700' as const },
  bubble: { borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 2 },
  bubbleMine: { backgroundColor: Colors.primary, borderTopRightRadius: Radius.sm },
  bubbleOther: { backgroundColor: Colors.surfaceContainerHigh, borderTopLeftRadius: Radius.sm },
  author: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' as const },
  image: { width: 200, height: 150, borderRadius: Radius.md, marginVertical: 2, backgroundColor: Colors.surfaceContainerHigh },
  body: { ...Typography.bodyMd, color: Colors.onSurface },
  bodyMine: { color: Colors.onPrimary },
  time: { ...Typography.caption, color: Colors.outline, alignSelf: 'flex-end' },
  timeMine: { color: 'rgba(255,255,255,0.7)' },
  reactRow: { flexDirection: 'row', gap: 4, marginTop: 3 },
  reactRowMine: { justifyContent: 'flex-end' },
  reactRowOther: { justifyContent: 'flex-start' },
  reactChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  reactChipMine: { backgroundColor: Colors.iconBgPurple },
  reactEmoji: { fontSize: 12 },
  reactCount: { ...Typography.caption, color: Colors.onSurfaceVariant },
  reactCountMine: { color: Colors.primary, fontWeight: '700' as const },
  quickReact: { opacity: 0.45, paddingHorizontal: 2 },
  quickEmoji: { fontSize: 13 },
  systemWrap: { alignSelf: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 5, marginVertical: Spacing.sm },
  systemText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
