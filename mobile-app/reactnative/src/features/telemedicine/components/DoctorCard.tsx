import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Clock, Video } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';
import { formatKobo } from '@/api/telemedicine.api';
import type { Doctor } from '@/types/telemedicine';
import DoctorAvatar from './DoctorAvatar';
import RatingStars from './RatingStars';

interface Props {
  doctor:  Doctor;
  onPress: () => void;
}

export default function DoctorCard({ doctor, onPress }: Props) {
  return (
    <Pressable onPress={onPress} style={[styles.card, shadow1]}>
      <DoctorAvatar initials={doctor.initials} color={doctor.avatarColor} online={doctor.isOnline} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{doctor.name}</Text>
        <Text style={styles.title} numberOfLines={1}>{doctor.specialties.join(' • ')}</Text>
        <RatingStars rating={doctor.rating} reviewCount={doctor.reviewCount} />
        <View style={styles.metaRow}>
          <View style={styles.meta}>
            <Clock size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.metaText}>{doctor.nextAvailable}</Text>
          </View>
        </View>
      </View>
      <View style={styles.right}>
        <Text style={styles.fee}>{formatKobo(doctor.feeKobo)}</Text>
        <Text style={styles.feeNote}>per visit</Text>
        <View style={styles.tag}>
          <Video size={12} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.tagText}>Video</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card:     { flexDirection: 'row', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  body:     { flex: 1, gap: 3, justifyContent: 'center' },
  name:     { ...Typography.titleMd, color: Colors.onSurface },
  title:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow:  { flexDirection: 'row', marginTop: 2 },
  meta:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  right:    { alignItems: 'flex-end', justifyContent: 'center', gap: 3 },
  fee:      { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' },
  feeNote:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  tag:      { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4, paddingHorizontal: 8, height: 24, borderRadius: Radius.full, backgroundColor: Colors.iconBgBlue },
  tagText:  { ...Typography.caption, color: Colors.secondary, fontWeight: '600' },
});
