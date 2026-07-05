import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Clock, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { ReferralColors } from '../constants/referral.constants';
import { formatCountdown } from '../constants/format';

interface Props {
  /** ISO timestamp when the grace window closes (§7A.3). */
  expiresAt: string | null;
  /** Called once when the window ticks past expiry, so the parent can lock UI. */
  onExpire?: () => void;
}

/**
 * Live countdown for the late code-claim grace window (M-INV-10). Ticks every
 * 30s; renders a locked state once the window closes. Shared so any screen that
 * shows the grace window renders it identically.
 */
export default function GraceCountdown({ expiresAt, onExpire }: Props) {
  const [remaining, setRemaining] = useState<string | null>(() => formatCountdown(expiresAt));

  useEffect(() => {
    setRemaining(formatCountdown(expiresAt));
    const id = setInterval(() => {
      const next = formatCountdown(expiresAt);
      setRemaining((prev) => {
        if (prev !== null && next === null) onExpire?.();
        return next;
      });
    }, 30_000);
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);

  const locked = remaining === null;

  return (
    <View style={[styles.wrap, locked ? styles.wrapLocked : styles.wrapOpen]}>
      {locked ? (
        <Lock size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
      ) : (
        <Clock size={16} color={Colors.onWarning} strokeWidth={2} />
      )}
      <Text style={[styles.label, locked ? styles.labelLocked : styles.labelOpen]}>
        {locked ? 'Window closed — attribution is locked' : `Time left to claim: ${remaining}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  wrapOpen: { backgroundColor: ReferralColors.warnBg },
  wrapLocked: { backgroundColor: Colors.surfaceContainer },
  label: { ...Typography.labelMd, flex: 1 },
  labelOpen: { color: Colors.onWarning },
  labelLocked: { color: Colors.onSurfaceVariant },
});
