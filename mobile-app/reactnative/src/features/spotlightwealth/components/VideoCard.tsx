import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Play, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { TOPIC_STYLE } from '../constants/spotlight.constants';
import type { FinanceVideo } from '../types/spotlight.types';

interface Props {
  video: FinanceVideo;
  onPress?: () => void;
  variant?: 'carousel' | 'list';
}

/** Creator finance-video card — placeholder tinted thumbnail + topic chip. */
export default function VideoCard({ video, onPress, variant = 'carousel' }: Props) {
  const topic = TOPIC_STYLE[video.topic];
  const carousel = variant === 'carousel';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${video.title} by ${video.creator}, ${video.durationMins} minutes`}
      style={({ pressed }) => [styles.card, carousel ? styles.carousel : styles.list, shadow1, pressed && styles.pressed]}
    >
      <View style={[styles.thumb, { backgroundColor: video.thumbnailColor }]}>
        <View style={styles.playBadge}>
          <Play size={18} color={Colors.onPrimary} fill={Colors.onPrimary} strokeWidth={0} />
        </View>
        <View style={styles.durationPill}>
          <Clock size={11} color={Colors.onPrimary} strokeWidth={2} />
          <Text style={styles.durationText}>{video.durationMins}m</Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={[styles.topicChip, { backgroundColor: topic.bg }]}>
          <Text style={[styles.topicText, { color: topic.fg }]}>{topic.label}</Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>{video.title}</Text>
        <Text style={styles.creator} numberOfLines={1}>{video.creator}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    overflow: 'hidden',
  },
  carousel: { width: 220 },
  list: { width: '100%' },
  pressed: { opacity: 0.85 },
  thumb: { height: 110, justifyContent: 'center', alignItems: 'center' },
  playBadge: {
    width: 44, height: 44, borderRadius: Radius.full,
    backgroundColor: 'rgba(0,0,0,0.28)', alignItems: 'center', justifyContent: 'center',
  },
  durationPill: {
    position: 'absolute', bottom: Spacing.sm, right: Spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
  },
  durationText: { ...Typography.caption, color: Colors.onPrimary },
  body: { padding: Spacing.md, gap: Spacing.xs },
  topicChip: { alignSelf: 'flex-start', borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  topicText: { ...Typography.labelSm },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  creator: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
