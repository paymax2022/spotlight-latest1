import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import StatusBadge from './StatusBadge';
import type { StatusTone } from './StatusBadge';

interface Props {
  service:     string;
  reference:   string;
  provider:    string;
  patientName: string;
  amountLabel: string;          // formatKobo(estimatedKobo) — display only
  statusLabel: string;
  statusTone:  StatusTone;
  onPress:     () => void;
}

// New component: a pre-authorisation list row (Section O). Mirrors the existing
// ClaimRow / ReferralRow list-card pattern but for a PreAuthRequest; no shared
// row component takes a service + ref + amount + status, so this row keeps the
// pre-auth list consistent with the rest of the doctor list screens.
export default function PreAuthRow({ service, reference: paRef, provider, patientName, amountLabel, statusLabel, statusTone, onPress }: Props) {
  return (
    <Pressable
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Pre-authorisation ${paRef} — ${service}`}
    >
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{service}</Text>
        <Text style={styles.meta} numberOfLines={1}>{paRef} · {provider}</Text>
        <Text style={styles.meta} numberOfLines={1}>{patientName} · {amountLabel}</Text>
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
  title: { ...Typography.titleMd, color: Colors.onSurface },
  meta:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  right: { alignItems: 'flex-end', gap: Spacing.xs },
});
