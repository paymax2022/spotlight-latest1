import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Hospital, Ambulance, Phone, MapPin, Clock } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  kind:        'hospital' | 'ambulance' | 'emergency_service';
  kindLabel:   string;
  name:        string;
  address:     string;
  distanceKm:  number;
  etaMins:     number;
  contact:     string;          // DEMO contact string — non-dialable
  open24h:     boolean;
  selected?:   boolean;
  onPress?:    () => void;      // DEMO selection only — never dials
}

// New component: an emergency facility row (Section R). DEMO + non-actionable —
// the contact is shown as text only and never dialed. No existing row composes a
// facility kind icon + distance/ETA + non-dialable contact, so it is justified.
const ICON: Record<Props['kind'], LucideIcon> = {
  hospital:          Hospital,
  ambulance:         Ambulance,
  emergency_service: Phone,
};

export default function EmergencyFacilityRow({ kind, kindLabel, name, address, distanceKm, etaMins, contact, open24h, selected, onPress }: Props) {
  const Icon = ICON[kind];
  return (
    <Pressable
      style={[styles.card, selected && styles.cardOn]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${name} — ${kindLabel} (demo, not dialable)`}
    >
      <View style={styles.iconBox}>
        <Icon size={20} color={Colors.error} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <View style={styles.metaRow}>
          <MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.meta} numberOfLines={1}>{address}{distanceKm > 0 ? ` · ${distanceKm} km` : ''}</Text>
        </View>
        <View style={styles.metaRow}>
          <Clock size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.meta} numberOfLines={1}>{kindLabel} · ETA {etaMins} min{open24h ? ' · 24h' : ''}</Text>
        </View>
        <Text style={styles.contact} numberOfLines={1}>{contact}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card:    { flexDirection: 'row', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh },
  cardOn:  { borderColor: Colors.error, backgroundColor: Colors.surfaceContainerLow },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.errorContainer },
  body:    { flex: 1, gap: 2 },
  name:    { ...Typography.labelLg, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  meta:    { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
  contact: { ...Typography.labelSm, color: Colors.error, marginTop: 2 },
});
