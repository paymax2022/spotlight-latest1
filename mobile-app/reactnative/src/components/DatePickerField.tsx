import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Calendar } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';

const ITEM_HEIGHT = 48;
const VISIBLE_ITEMS = 5;
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function range(start: number, end: number): number[] {
  const arr: number[] = [];
  for (let i = start; i <= end; i++) arr.push(i);
  return arr;
}

function daysInMonth(month: number, year: number) {
  return new Date(year, month, 0).getDate();
}

interface WheelProps {
  items: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  width?: number;
}

// Exported so TimePickerField can reuse the exact same wheel rather than ship a
// second, subtly-different implementation of scroll-snapping.
export function WheelPicker({ items, selectedIndex, onSelect, width = 80 }: WheelProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) {
      scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_HEIGHT, animated: false });
    }
  }, [selectedIndex, isDragging]);

  const handleScrollEnd = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      const index = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(index, items.length - 1));
      onSelect(clamped);
      setIsDragging(false);
    },
    [items.length, onSelect],
  );

  return (
    <View style={[styles.wheel, { width }]}>
      <View style={styles.wheelHighlight} pointerEvents="none" />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        onScrollBeginDrag={() => setIsDragging(true)}
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
        contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
      >
        {items.map((item, i) => (
          <Pressable
            key={item}
            onPress={() => {
              onSelect(i);
              scrollRef.current?.scrollTo({ y: i * ITEM_HEIGHT, animated: true });
            }}
            style={styles.wheelItem}
          >
            <Text
              style={[
                styles.wheelLabel,
                i === selectedIndex && styles.wheelLabelActive,
              ]}
              numberOfLines={1}
            >
              {item}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

interface DatePickerFieldProps {
  label?: string;
  value?: string;
  onChange: (isoDate: string) => void;
  error?: string;
  minYear?: number;
  maxYear?: number;
  /** YYYY-MM-DD. The latest date that can be picked (e.g. today for a birth date). */
  maxDate?: string;
}

function parseIsoDate(iso?: string): { y: number; m: number; d: number } | null {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return match ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) } : null;
}

export default function DatePickerField({
  label,
  value,
  onChange,
  error,
  minYear = 1940,
  maxYear: maxYearProp = new Date().getFullYear() - 5,
  maxDate,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);

  // A maxDate sets the year ceiling too, so the year wheel stops at that year
  // instead of the default "five years ago" cap (which would hide young pets).
  const max = parseIsoDate(maxDate);
  const maxYear = max ? max.y : maxYearProp;
  // Keeps a (year, month, day) at or before maxDate; a no-op without one.
  const clampToMax = (y: number, m: number, d: number) => {
    if (!max) return { y, m, d };
    const after = y > max.y || (y === max.y && (m > max.m || (m === max.m && d > max.d)));
    return after ? { y: max.y, m: max.m, d: max.d } : { y, m, d };
  };

  // With no value yet, the wheels must default to something INSIDE
  // [minYear, maxYear] — a caller whose range doesn't cover a fixed arbitrary
  // year (this used to be 1990 unconditionally) got a wheel that visually
  // clamped to the top of its list while the year state silently stayed on
  // the out-of-range default. Confirming without ever touching the year
  // wheel then submitted a value outside the very range the caller asked
  // for. Defaulting to today, clamped into range, is always a valid pick.
  const parsed = value ? new Date(value) : null;
  const today = new Date();
  const initYear  = parsed ? parsed.getUTCFullYear()  : Math.min(Math.max(today.getFullYear(), minYear), maxYear);
  const initMonth = parsed ? parsed.getUTCMonth() + 1 : today.getMonth() + 1;
  const initDay   = parsed ? parsed.getUTCDate()      : today.getDate();
  const init = clampToMax(initYear, initMonth, initDay);

  const [selYear,  setSelYear]  = useState(init.y);
  const [selMonth, setSelMonth] = useState(init.m);
  const [selDay,   setSelDay]   = useState(init.d);

  // Scrolling the wheels past maxDate pulls the selection back to it.
  useEffect(() => {
    const c = clampToMax(selYear, selMonth, selDay);
    if (c.y !== selYear || c.m !== selMonth || c.d !== selDay) {
      setSelYear(c.y);
      setSelMonth(c.m);
      setSelDay(c.d);
    }
    // clampToMax closes over maxDate; the selection is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selYear, selMonth, selDay, maxDate]);

  const years  = range(minYear, maxYear).map(String);
  const months = MONTHS;
  const days   = range(1, daysInMonth(selMonth, selYear)).map(String);

  const yearIndex  = selYear  - minYear;
  const monthIndex = selMonth - 1;
  const dayIndex   = Math.min(selDay - 1, days.length - 1);

  const onConfirm = () => {
    const c   = clampToMax(selYear, selMonth, Math.min(selDay, daysInMonth(selMonth, selYear)));
    const mm  = String(c.m).padStart(2, '0');
    const dd  = String(c.d).padStart(2, '0');
    onChange(`${c.y}-${mm}-${dd}`);
    setOpen(false);
  };

  const displayValue = value
    ? (() => {
        const d = new Date(value + 'T00:00:00');
        return d.toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' });
      })()
    : 'Select date';

  const screenWidth = Dimensions.get('window').width;

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.trigger, !!error && styles.triggerError]}
      >
        <Text style={[styles.triggerText, !value && styles.triggerPlaceholder]}>
          {displayValue}
        </Text>
        <Calendar size={18} color={Colors.outline} strokeWidth={2} />
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={[styles.sheet, { width: screenWidth }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{label ?? 'Select Date'}</Text>

          <View style={styles.pickers}>
            <View style={styles.pickerCol}>
              <Text style={styles.pickerColLabel}>Day</Text>
              <WheelPicker
                items={days}
                selectedIndex={dayIndex}
                onSelect={(i) => setSelDay(i + 1)}
                width={60}
              />
            </View>
            <View style={styles.pickerCol}>
              <Text style={styles.pickerColLabel}>Month</Text>
              <WheelPicker
                items={months}
                selectedIndex={monthIndex}
                onSelect={(i) => setSelMonth(i + 1)}
                width={screenWidth * 0.38}
              />
            </View>
            <View style={styles.pickerCol}>
              <Text style={styles.pickerColLabel}>Year</Text>
              <WheelPicker
                items={years}
                selectedIndex={yearIndex}
                onSelect={(i) => setSelYear(minYear + i)}
                width={70}
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
  wrapper:  { marginBottom: Spacing.md },
  label:    { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  trigger: {
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'space-between',
    backgroundColor:  Colors.surfaceContainerLow,
    borderRadius:     Radius.lg,
    borderWidth:      1.5,
    borderColor:      Colors.transparent,
    height:           56,
    paddingHorizontal: Spacing.md,
  },
  triggerError: { borderColor: Colors.error },
  triggerText:  { ...Typography.bodyMd, color: Colors.onSurface },
  triggerPlaceholder: { color: Colors.outline },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor:  Colors.surfaceContainerLowest,
    borderTopLeftRadius:  Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingBottom: 40,
    alignItems: 'center',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceContainerHigh,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  sheetTitle: {
    ...Typography.titleMd,
    color: Colors.onSurface,
    marginBottom: Spacing.md,
  },
  pickers: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  pickerCol: { alignItems: 'center' },
  pickerColLabel: {
    ...Typography.labelSm,
    color: Colors.onSurfaceVariant,
    marginBottom: Spacing.xs,
  },
  wheel: {
    height:     PICKER_HEIGHT,
    overflow:   'hidden',
    position:   'relative',
  },
  wheelHighlight: {
    position:        'absolute',
    top:             ITEM_HEIGHT * 2,
    left:            0,
    right:           0,
    height:          ITEM_HEIGHT,
    borderTopWidth:  1,
    borderBottomWidth: 1,
    borderColor:     Colors.primary,
    zIndex:          1,
    borderRadius:    Radius.sm,
    backgroundColor: Colors.primaryFixed,
    opacity:         0.4,
  },
  wheelItem: {
    height:          ITEM_HEIGHT,
    alignItems:      'center',
    justifyContent:  'center',
  },
  wheelLabel: {
    ...Typography.bodyMd,
    color:      Colors.onSurfaceVariant,
    textAlign:  'center',
  },
  wheelLabelActive: {
    color:      Colors.onSurface,
    fontWeight: '700',
  },
  actions: {
    flexDirection:   'row',
    gap:             Spacing.md,
    marginTop:       Spacing.lg,
    paddingHorizontal: Spacing.lg,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    height: 52,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  confirmBtn: {
    flex: 2,
    height: 52,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primary,
    alignItems:      'center',
    justifyContent:  'center',
  },
  confirmLabel: { ...Typography.labelLg, color: Colors.onPrimary },
});
