import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { DoctorAvatar } from '@/features/telemedicine/components';
import StatusBadge from './StatusBadge';
import type { StatusTone } from './StatusBadge';

interface Props {
  initials:    string;
  avatarColor: string;
  patientName: string;
  reference:   string;
  fromDoctor:  string;
  specialty:   string;
  urgent:      boolean;
  statusLabel: string;
  statusTone:  StatusTone;
  onPress:     () => void;
}

// New component: an incoming-referral inbox row (Section P). Mirrors ClaimRow /
// ReferralRow but surfaces the REFERRING doctor + specialty + urgency for the
// receiving clinician. No existing row carries that inbound shape, so it keeps
// the incoming list consistent with the other doctor list screens.
export default function IncomingReferralRow({ initials, avatarColor, patientName, reference: refCode, fromDoctor, specialty, urgent, statusLabel, statusTone, onPress }: Props) {
  return (
    <Pressable
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Incoming referral ${refCode} for ${patientName}`}
    >
      <DoctorAvatar initials={initials} color={avatarColor} size={44} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{patientName}</Text>
        <Text style={styles.meta} numberOfLines={1}>{specialty} · {refCode}</Text>
        <Text style={styles.meta} numberOfLines={1}>From {fromDoctor}{urgent ? ' · Urgent' : ''}</Text>
      </View>
      <View style={styles.right}>
        <StatusBadge label={statusLabel} tone={statusTone} />
        <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  body:  { flex: 1, gap: 2 },
  name:  { ...Typography.titleMd, color: Colors.onSurface },
  meta:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  right: { alignItems: 'flex-end', gap: Spacing.xs },
});
