// ── Marketplace — MeetupSafeSpots (Screen 27 Meetup Mode) ────────────────────
// Renders verified-safe-spot suggestions (police forecourts, bank branches,
// well-lit public spots) as selectable rows. Data comes from /meetup/safe-spots
// (being added by another agent) with a mock fallback.
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Shield, Landmark, Building2, MapPin, Check, BadgeCheck } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { MarketColors } from '@/features/marketplace';
import type { SafeSpot } from '@/features/marketplace/api/meetup.api';

const CATEGORY_ICON = {
  police: Shield,
  bank: Landmark,
  mall: Building2,
  public: MapPin,
} as const;

export default function MeetupSafeSpots({
  spots,
  selectedId,
  onSelect,
}: {
  spots: SafeSpot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.wrap}>
      {spots.map((s) => {
        const Icon = CATEGORY_ICON[s.category] ?? MapPin;
        const active = selectedId === s.id;
        return (
          <Pressable key={s.id} style={[styles.row, active && styles.rowActive]} onPress={() => onSelect(s.id)}>
            <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
              <Icon size={18} color={active ? MarketColors.brand : MarketColors.muted} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                {s.verified ? <BadgeCheck size={14} color={MarketColors.ok} /> : null}
              </View>
              <Text style={styles.meta}>{s.address} · {s.distanceKm.toFixed(1)} km</Text>
            </View>
            {active ? <Check size={18} color={MarketColors.brand} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderWidth: 1.5, borderColor: MarketColors.border, borderRadius: Radius.lg, padding: Spacing.sm + 2 },
  rowActive: { borderColor: MarketColors.brand, backgroundColor: MarketColors.warnBg },
  iconWrap: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: MarketColors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  iconWrapActive: { backgroundColor: MarketColors.surface },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700', flexShrink: 1 },
  meta: { ...Typography.labelSm, color: MarketColors.muted, marginTop: 2 },
});
