import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Minus, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface StepperProps {
  label?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  error?: string;
  disabled?: boolean;
}

/**
 * Shared quantity stepper (increment / decrement within [min, max]). Not to be
 * confused with `features/arena/components/Stepper.tsx`, which is an unrelated
 * wizard progress-dots component that happens to share the name.
 *
 * Bounds are clamped defensively — `value` may arrive out of range (a stale
 * prefill, a schema whose min/max changed) and both buttons must still reflect
 * reality rather than let the count drift further outside it.
 */
export default function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
  unit,
  error,
  disabled = false,
}: StepperProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const current = clamp(Number.isFinite(value) ? value : min);
  const canDecrement = !disabled && current - step >= min;
  const canIncrement = !disabled && current + step <= max;

  const decrement = () => canDecrement && onChange(clamp(current - step));
  const increment = () => canIncrement && onChange(clamp(current + step));

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.track, disabled && styles.trackDisabled, !!error && styles.trackError]}>
        <Pressable
          onPress={decrement}
          disabled={!canDecrement}
          accessibilityRole="button"
          accessibilityLabel="Decrease"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[styles.btn, !canDecrement && styles.btnDisabled]}
        >
          <Minus size={18} color={canDecrement ? Colors.primary : Colors.outline} strokeWidth={2.5} />
        </Pressable>

        <Text style={styles.value} numberOfLines={1}>
          {current}
          {unit ? ` ${unit}` : ''}
        </Text>

        <Pressable
          onPress={increment}
          disabled={!canIncrement}
          accessibilityRole="button"
          accessibilityLabel="Increase"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[styles.btn, !canIncrement && styles.btnDisabled]}
        >
          <Plus size={18} color={canIncrement ? Colors.primary : Colors.outline} strokeWidth={2.5} />
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: Spacing.md },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.transparent,
    height: 56,
    paddingHorizontal: Spacing.sm,
  },
  trackDisabled: { opacity: 0.5 },
  trackError: { borderColor: Colors.error },
  btn: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
  },
  btnDisabled: { backgroundColor: Colors.surfaceContainerLow },
  value: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '700', flex: 1, textAlign: 'center' },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
});
