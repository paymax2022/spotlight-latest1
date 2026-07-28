import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Timer } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { VotingColors } from '../constants/voting.constants';

interface Props {
  /** ISO timestamp when free votes become active again. */
  resetAt: string;
  /** Fired once when the countdown reaches zero (refetch the allocation). */
  onReset?: () => void;
  size?: 'sm' | 'md';
  /** Prefix label; defaults to "Free votes reset in". */
  label?: string;
}

function fmt(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// Live countdown shown when a contestant's daily free votes are used up. The
// user watches it tick down and sees exactly when free voting reactivates.
export default function FreeVoteResetCountdown({ resetAt, onReset, size = 'md', label = 'Free votes reset in' }: Props) {
  const target = Date.parse(resetAt);
  const [remaining, setRemaining] = useState(() => Math.max(0, target - Date.now()));
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    setRemaining(Math.max(0, target - Date.now()));
    const id = setInterval(() => {
      const left = Math.max(0, target - Date.now());
      setRemaining(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        onReset?.();
        clearInterval(id);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [target, onReset]);

  const isSm = size === 'sm';
  if (!Number.isFinite(target)) return null;

  return (
    <View style={[styles.wrap, isSm && styles.wrapSm]}>
      <Timer size={isSm ? 13 : 15} color={VotingColors.freeVote} strokeWidth={2} />
      <Text style={[styles.label, isSm && styles.labelSm]} numberOfLines={1}>
        {label} <Text style={styles.time}>{fmt(remaining)}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 7, paddingHorizontal: 12,
    borderRadius: Radius.full, backgroundColor: VotingColors.freeVoteBg,
  },
  wrapSm: { paddingVertical: 5, paddingHorizontal: 10, gap: 5 },
  label: { ...Typography.bodySm, color: VotingColors.freeVote, fontWeight: '600' },
  labelSm: { ...Typography.labelSm, color: VotingColors.freeVote, fontWeight: '600' },
  time: { fontWeight: '800', fontVariant: ['tabular-nums'] },
});
