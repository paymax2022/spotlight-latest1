import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Lock, TimerReset } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { secondsUntil, formatCountdown } from '../utils/fxFormatters';
import { RATE_LOCK_SECONDS } from '../constants/fx.constants';

interface Props {
  expiresAt: string;
  onExpire?: () => void;
}

/**
 * Rate-lock countdown pill (spec C → Rate-lock countdown). Ticks once a second
 * and fires onExpire when the locked rate window elapses, driving the re-quote
 * path. Bar tints from teal → error as time runs low.
 */
export default function RateLockCountdown({ expiresAt, onExpire }: Props) {
  const [seconds, setSeconds] = useState(() => secondsUntil(expiresAt));

  useEffect(() => {
    setSeconds(secondsUntil(expiresAt));
    const id = setInterval(() => {
      const left = secondsUntil(expiresAt);
      setSeconds(left);
      if (left <= 0) {
        clearInterval(id);
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);

  const expired = seconds <= 0;
  const low = seconds <= 15;
  const pct = Math.max(0, Math.min(1, seconds / RATE_LOCK_SECONDS));
  const tint = expired || low ? Colors.error : Colors.teal;

  return (
    <View style={[styles.wrap, { backgroundColor: expired ? Colors.errorContainer : Colors.iconBgTeal }]}>
      <View style={styles.row}>
        {expired
          ? <TimerReset size={15} color={Colors.error} strokeWidth={2} />
          : <Lock size={15} color={tint} strokeWidth={2} />}
        <Text style={[styles.label, { color: tint }]}>
          {expired ? 'Rate expired — re-quote needed' : `Rate locked · ${formatCountdown(seconds)}`}
        </Text>
      </View>
      {!expired ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: tint }]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { ...Typography.labelMd },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.06)', overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
});
