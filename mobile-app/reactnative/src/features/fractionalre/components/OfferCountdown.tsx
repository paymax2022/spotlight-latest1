import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { countdownLabel, msUntil } from '../utils';

/** Live countdown chip for a funding window. Ticks once a minute. */
export default function OfferCountdown({ closesAt, inline }: { closesAt: string | null; inline?: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!closesAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [closesAt]);

  if (!closesAt) return null;
  const ms = msUntil(closesAt);
  const closed = ms !== null && ms <= 0;
  const urgent = ms !== null && ms > 0 && ms < 3 * 86_400_000;
  const color = closed ? Colors.onSurfaceVariant : urgent ? Colors.onWarning : Colors.secondary;

  if (inline) {
    return <Text style={[styles.inline, { color }]}>{closed ? 'Closed' : `Closes in ${countdownLabel(closesAt)}`}</Text>;
  }
  return (
    <View style={[styles.chip, { backgroundColor: color + '14' }]}>
      <Clock size={13} color={color} strokeWidth={2} />
      <Text style={[styles.label, { color }]}>{closed ? 'Closed' : countdownLabel(closesAt)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: Radius.full, alignSelf: 'flex-start',
  },
  label: { ...Typography.labelSm, fontWeight: '600' },
  inline: { ...Typography.labelSm, fontWeight: '600' },
});
