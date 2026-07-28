import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Timer } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  /** ISO target time. */
  targetIso?: string | null;
  label?: string;
  /** Called once the target passes (e.g. open the exam window). */
  onElapsed?: () => void;
  compact?: boolean;
}

function remaining(target: number): { d: number; h: number; m: number; s: number; done: boolean } {
  const diff = Math.max(0, target - Date.now());
  const done = diff <= 0;
  const s = Math.floor(diff / 1000);
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
    done,
  };
}

/** T-minus countdown used on C5 (exam batch) and S1/S8 (event countdowns). */
export default function Countdown({ targetIso, label, onElapsed, compact }: Props) {
  const target = targetIso ? new Date(targetIso).getTime() : NaN;
  const valid = !Number.isNaN(target);
  const [t, setT] = useState(() => (valid ? remaining(target) : null));

  useEffect(() => {
    if (!valid) return;
    const id = setInterval(() => {
      const next = remaining(target);
      setT(next);
      if (next.done) {
        clearInterval(id);
        onElapsed?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [target, valid, onElapsed]);

  if (!valid || !t) {
    return (
      <View style={[styles.box, compact && styles.compact]}>
        <Timer size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
        <Text style={styles.muted}>Schedule to be announced</Text>
      </View>
    );
  }

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <View style={[styles.box, compact && styles.compact]}>
      <Timer size={16} color={Colors.secondary} strokeWidth={2} />
      <View style={{ flex: 1 }}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <Text style={styles.time}>
          {t.done
            ? 'Now'
            : t.d > 0
              ? `${t.d}d ${pad(t.h)}h ${pad(t.m)}m`
              : `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  compact: { padding: Spacing.sm, borderRadius: Radius.md },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  time: { ...Typography.titleMd, color: Colors.onSurface, fontVariant: ['tabular-nums'] },
  muted: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
