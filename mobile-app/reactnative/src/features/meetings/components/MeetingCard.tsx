import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { ChevronRight, Users, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { MEETING_MODE_META, MEETING_STATUS_LABELS, MeetingColors, RSVP_META } from '../constants/meetings.constants';
import { derivedStatus, formatMeetingWhen, totalRsvp } from '../utils/meetingsFormatters';
import type { Meeting } from '../types/meetings.types';

export default function MeetingCard({ meeting, onPress }: { meeting: Meeting; onPress?: () => void }) {
  const status = derivedStatus(meeting);
  const modeMeta = MEETING_MODE_META[meeting.mode];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[modeMeta.icon] ?? Icons.Users;
  const statusColor = status === 'live' ? MeetingColors.live : status === 'cancelled' ? MeetingColors.cancelled : status === 'ended' ? MeetingColors.ended : MeetingColors.scheduled;
  const statusBg = status === 'live' ? MeetingColors.liveBg : status === 'cancelled' ? MeetingColors.cancelledBg : status === 'ended' ? MeetingColors.endedBg : MeetingColors.scheduledBg;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.iconBox}><Icon size={20} color={Colors.primary} strokeWidth={1.8} /></View>
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.title} numberOfLines={1}>{meeting.title}</Text>
          <View style={[styles.chip, { backgroundColor: statusBg }]}>
            {status === 'live' ? <View style={[styles.dot, { backgroundColor: statusColor }]} /> : null}
            <Text style={[styles.chipText, { color: statusColor }]}>{MEETING_STATUS_LABELS[status]}</Text>
          </View>
        </View>
        <Text style={styles.when}>{formatMeetingWhen(meeting.startsAt)} · {modeMeta.label}</Text>
        <View style={styles.metaRow}>
          {meeting.location ? (
            <View style={styles.metaItem}><MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={1.8} /><Text style={styles.metaText} numberOfLines={1}>{meeting.location}</Text></View>
          ) : null}
          <View style={styles.metaItem}><Users size={12} color={Colors.onSurfaceVariant} strokeWidth={1.8} /><Text style={styles.metaText}>{totalRsvp(meeting)} responses</Text></View>
          {meeting.myRsvp ? (
            <View style={[styles.rsvpTag, { backgroundColor: RSVP_META[meeting.myRsvp].bg }]}>
              <Text style={[styles.rsvpText, { color: RSVP_META[meeting.myRsvp].color }]}>{RSVP_META[meeting.myRsvp].label}</Text>
            </View>
          ) : null}
        </View>
      </View>
      {onPress ? <ChevronRight size={18} color={Colors.outline} strokeWidth={1.8} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  pressed: { opacity: 0.85 },
  iconBox: { width: 46, height: 46, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 3 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  dot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { ...Typography.labelSm, fontWeight: '700' },
  when: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flexWrap: 'wrap' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, maxWidth: 140 },
  rsvpTag: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  rsvpText: { ...Typography.labelSm, fontWeight: '700' },
});
