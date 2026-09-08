import React, { useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Dimensions } from 'react-native';
import { Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { WheelPicker } from '@/components/DatePickerField';

/**
 * Time counterpart to DatePickerField — same trigger, same bottom sheet, same
 * scroll-snapping wheel (imported rather than reimplemented, so the two cannot
 * drift apart in feel).
 *
 * Emits 24-hour `HH:MM`, which is what the callers' validators already expect;
 * the TRIGGER renders 12-hour with am/pm because that is how a time is read
 * aloud here, while the wire format stays unambiguous.
 *
 * Minutes step in 5s. A meeting proposed for 18:37 is not a real intention, and
 * a 60-item wheel is materially harder to land on than a 12-item one.
 */
const MINUTE_STEP = 5;
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) =>
  String(i * MINUTE_STEP).padStart(2, '0'),
);

function parse(value?: string): { h: number; m: number } | null {
  if (!value || !/^\d{1,2}:\d{2}$/.test(value.trim())) return null;
  const [hs, ms] = value.trim().split(':');
  const h = Number(hs);
  const m = Number(ms);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return null;
  return { h, m };
}

/** 24h -> "6:30 pm". Display only; the value on the wire stays 24-hour. */
function display(value?: string): string | null {
  const p = parse(value);
  if (!p) return null;
  const suffix = p.h < 12 ? 'am' : 'pm';
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h12}:${String(p.m).padStart(2, '0')} ${suffix}`;
}

interface TimePickerFieldProps {
  label?: string;
  value?: string;
  onChange: (time: string) => void;
  error?: string;
  placeholder?: string;
}

export default function TimePickerField({
  label,
  value,
  onChange,
  error,
  placeholder = 'Select time',
}: TimePickerFieldProps) {
  const [open, setOpen] = useState(false);

  // Default to the next clean 5-minute slot rather than 00:00 — opening the
  // sheet on midnight means every user scrolls past the whole morning.
  const parsed = parse(value);
  const now = new Date();
  const initH = parsed ? parsed.h : now.getHours();
  const initM = parsed
    ? Math.round(parsed.m / MINUTE_STEP) * MINUTE_STEP % 60
    : Math.ceil(now.getMinutes() / MINUTE_STEP) * MINUTE_STEP % 60;

  const [selH, setSelH] = useState(initH);
  const [selM, setSelM] = useState(initM);

  const hourIndex = Math.min(Math.max(selH, 0), 23);
  const minuteIndex = Math.min(Math.max(Math.round(selM / MINUTE_STEP), 0), MINUTES.length - 1);

  const onConfirm = () => {
    onChange(`${String(selH).padStart(2, '0')}:${MINUTES[minuteIndex]}`);
    setOpen(false);
  };

  const shown = display(value);
  const screenWidth = Dimensions.get('window').width;

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.trigger, !!error && styles.triggerError]}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}. ${shown ?? placeholder}` : (shown ?? placeholder)}
      >
        <Text style={[styles.triggerText, !shown && styles.triggerPlaceholder]}>
          {shown ?? placeholder}
        </Text>
        <Clock size={18} color={Colors.outline} strokeWidth={2} />
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={[styles.sheet, { width: screenWidth }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{label ?? 'Select time'}</Text>

          <View style={styles.pickers}>
            <View style={styles.pickerCol}>
              <Text style={styles.pickerColLabel}>Hour</Text>
              <WheelPicker
                items={HOURS}
                selectedIndex={hourIndex}
                onSelect={(i) => setSelH(i)}
                width={80}
              />
            </View>
            <Text style={styles.colon}>:</Text>
            <View style={styles.pickerCol}>
              <Text style={styles.pickerColLabel}>Minute</Text>
              <WheelPicker
                items={MINUTES}
                selectedIndex={minuteIndex}
                onSelect={(i) => setSelM(i * MINUTE_STEP)}
                width={80}
              />
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable onPress={() => setOpen(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable onPress={onConfirm} style={styles.confirmBtn}>
              <Text style={styles.confirmLabel}>Confirm</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: Spacing.md },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.transparent,
    height: 56,
    paddingHorizontal: Spacing.md,
  },
  triggerError: { borderColor: Colors.error },
  triggerText: { ...Typography.bodyMd, color: Colors.onSurface },
  triggerPlaceholder: { color: Colors.outline },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingBottom: 40,
    alignItems: 'center',
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.outlineVariant,
    marginTop: Spacing.sm, marginBottom: Spacing.md,
  },
  sheetTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.md },
  pickers: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  pickerCol: { alignItems: 'center' },
  pickerColLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  colon: { ...Typography.titleLg, color: Colors.onSurfaceVariant, marginTop: Spacing.lg },
  actions: {
    flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg, width: '100%',
  },
  cancelBtn: {
    flex: 1, height: 52, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelLabel: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  confirmBtn: {
    flex: 2, height: 52, borderRadius: Radius.lg,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmLabel: { ...Typography.labelLg, color: Colors.onPrimary, fontWeight: '700' as const },
});
