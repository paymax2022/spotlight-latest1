import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  endsAt?: string;
  size?: 'sm' | 'md' | 'lg';
  color?: string;
}

function getRemaining(endsAt?: string) {
  if (!endsAt) return null;
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return null;
  return {
    days:  Math.floor(diff / 86_400_000),
    hours: Math.floor((diff % 86_400_000) / 3_600_000),
    mins:  Math.floor((diff % 3_600_000) / 60_000),
    secs:  Math.floor((diff % 60_000) / 1_000),
  };
}

export default function CountdownTimer({ endsAt, size = 'md', color }: Props) {
  const [remaining, setRemaining] = useState(getRemaining(endsAt));

  useEffect(() => {
    const id = setInterval(() => setRemaining(getRemaining(endsAt)), 1_000);
    return () => clearInterval(id);
  }, [endsAt]);

  if (!remaining) {
    return <Text style={[styles.ended, size === 'sm' && styles.sm, { color: color ?? Colors.outline }]}>Voting Ended</Text>;
  }

  const isSmall = size === 'sm';
  const isLarge = size === 'lg';

  if (remaining.days > 0) {
    return (
      <Text style={[styles.simple, isSmall && styles.sm, isLarge && styles.lg, { color: color ?? Colors.onSurface }]}>
        {remaining.days}d {remaining.hours}h left
      </Text>
    );
  }

  const segments = [
    { label: 'H', value: String(remaining.hours).padStart(2, '0') },
    { label: 'M', value: String(remaining.mins).padStart(2, '0') },
    { label: 'S', value: String(remaining.secs).padStart(2, '0') },
  ];

  return (
    <View style={styles.row}>
      {segments.map((seg, i) => (
        <React.Fragment key={seg.label}>
          {i > 0 && <Text style={[styles.colon, { color: color ?? Colors.outline }]}>:</Text>}
          <View style={[styles.block, isSmall && styles.blockSm]}>
            <Text style={[styles.digit, isSmall && styles.digitSm, isLarge && styles.digitLg, { color: color ?? Colors.onSurface }]}>
              {seg.value}
            </Text>
            <Text style={[styles.unit, { color: color ?? Colors.onSurfaceVariant }]}>{seg.label}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', gap: 2 },
  block:   { alignItems: 'center', minWidth: 32 },
  blockSm: { minWidth: 24 },
  digit:   { ...Typography.titleMd, fontWeight: '700' as const },
  digitSm: { fontSize: 14, lineHeight: 18 },
  digitLg: { fontSize: 28, lineHeight: 34 },
  unit:    { ...Typography.caption, marginTop: -2 },
  colon:   { ...Typography.titleMd, marginBottom: 6, paddingHorizontal: 1 },
  simple:  { ...Typography.labelMd, color: Colors.onSurface },
  sm:      { fontSize: 12 },
  lg:      { fontSize: 20 },
  ended:   { ...Typography.labelSm, color: Colors.outline },
});
