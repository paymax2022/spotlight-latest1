import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Calendar, MapPin } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { EventColors, formatNaira, EVENT_STATE_BADGE, eventCoverEmoji, eventBannerColor } from '../constants/events.constants';
import type { EventSummary } from '../types';

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function EventCard({ event, onPress }: { event: EventSummary; onPress: () => void }) {
  const meta = EVENT_STATE_BADGE[event.state] ?? EVENT_STATE_BADGE.APPROVED;
  const bannerColor = eventBannerColor(event.id, event.category);
  const coverEmoji = eventCoverEmoji(event.category);
  const price = event.min_price_kobo ?? 0;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}>
      <View style={[styles.cover, { backgroundColor: bannerColor }]}>
        <Text style={styles.coverEmoji}>{coverEmoji}</Text>
        <View style={[styles.badge, { backgroundColor: meta.bg }]}>
          <Text style={[styles.badgeText, { color: meta.color }]}>{event.sold_out ? 'Sold out' : meta.label}</Text>
        </View>
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{event.title}</Text>
        <View style={styles.metaRow}>
          <Calendar size={13} color={EventColors.muted} strokeWidth={1.8} />
          <Text style={styles.metaText} numberOfLines={1}>{dateLabel(event.starts_at)}</Text>
        </View>
        <View style={styles.metaRow}>
          <MapPin size={13} color={EventColors.muted} strokeWidth={1.8} />
          <Text style={styles.metaText} numberOfLines={1}>{event.venue}</Text>
        </View>
        <Text style={styles.price}>
          {price === 0 ? 'Free' : `From ${formatNaira(price)}`}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, overflow: 'hidden', ...shadow1 },
  cover: { height: 120, alignItems: 'center', justifyContent: 'center' },
  coverEmoji: { fontSize: 44 },
  badge: { position: 'absolute', top: Spacing.sm, left: Spacing.sm, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  badgeText: { ...Typography.labelSm, fontWeight: '700' as const },
  body: { padding: Spacing.md, gap: 4 },
  title: { ...Typography.titleMd, color: EventColors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { ...Typography.bodySm, color: EventColors.muted, flex: 1 },
  price: { ...Typography.labelLg, color: EventColors.brand, marginTop: 4 },
});
