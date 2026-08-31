import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Check, Palette } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

/** CSS-renderable colour keywords this app's option vocab actually uses today
 *  (see supabase/migrations/20270151000000_marketplace_attribute_schemas.sql).
 *  A value outside this list — chiefly the catch-all "other" option every
 *  colour field carries — isn't a paintable colour and must fall back to the
 *  neutral swatch below rather than be handed to `backgroundColor` as-is. */
const RENDERABLE_COLOR_KEYWORDS = new Set([
  'black', 'white', 'silver', 'gray', 'grey', 'red', 'blue', 'green',
  'yellow', 'brown', 'gold', 'pink', 'purple', 'orange', 'navy', 'maroon',
  'olive', 'teal', 'cyan', 'magenta', 'beige', 'tan', 'ivory', 'khaki',
  'coral', 'turquoise', 'indigo', 'violet', 'crimson', 'salmon',
]);

function isRenderableColor(css: string): boolean {
  const v = css.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v)) return true;
  if (/^rgb\(/.test(v) || /^rgba\(/.test(v)) return true;
  return RENDERABLE_COLOR_KEYWORDS.has(v);
}

export interface ColorSwatchOption {
  /** The CSS colour rendered as the swatch fill — a hex string or a named
   *  CSS colour (e.g. "#1D1D1F", "midnightblue"). This is what gets returned
   *  as the field's value, so it must be whatever the caller wants back, not
   *  just a display hint. */
  value: string;
  /** Accessible / visible name shown under the swatch (e.g. "Midnight Black"). */
  label: string;
}

interface Props {
  label?: string;
  options: ColorSwatchOption[];
  value?: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

const SWATCH_SIZE = 40;

/** Best-effort check that a swatch fill is light enough to need a dark check
 *  mark and a visible border instead of the default white check / faint ring.
 *  Named CSS colours (no way to compute luminance without a table) fall back
 *  to "dark enough" — the common case for named colours used here (brand-ish
 *  names like "gold", "navy") — rather than mis-guessing. */
function isLightColor(css: string): boolean {
  const hex = css.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return false;
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.72;
}

/**
 * Single-select row of tappable colour swatches — the "color" widget in the
 * attribute-form catalog (phone colour, car colour, fabric colour…). Mirrors
 * the shared SelectField/MultiSelectField family: controlled `value` +
 * `onChange(value)`, optional `label`/`error`/`disabled`.
 */
export default function ColorSwatchPicker({ label, options, value, onChange, error, disabled }: Props) {
  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {options.map((o) => {
          const active = o.value === value;
          const renderable = isRenderableColor(o.value);
          const light = renderable && isLightColor(o.value);
          return (
            <Pressable
              key={o.value}
              onPress={() => !disabled && onChange(o.value)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled: !!disabled }}
              accessibilityLabel={o.label}
              style={styles.item}
            >
              <View
                style={[
                  styles.swatch,
                  renderable ? { backgroundColor: o.value } : styles.swatchNeutral,
                  light && styles.swatchLightBorder,
                  active && styles.swatchActive,
                  disabled && styles.swatchDisabled,
                ]}
              >
                {active ? (
                  <Check size={16} color={light ? Colors.onSurface : '#fff'} strokeWidth={3} />
                ) : !renderable ? (
                  <Palette size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                ) : null}
              </View>
              <Text style={[styles.itemLabel, active && styles.itemLabelActive]} numberOfLines={1}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: Spacing.md },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  row: { flexDirection: 'row', gap: Spacing.md, paddingVertical: 2 },
  item: { alignItems: 'center', width: SWATCH_SIZE + Spacing.sm },
  swatch: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchLightBorder: { borderColor: Colors.outline },
  swatchNeutral: { backgroundColor: Colors.surfaceContainerLow },
  swatchActive: { borderWidth: 2.5, borderColor: Colors.primary },
  swatchDisabled: { opacity: 0.4 },
  itemLabel: {
    ...Typography.labelSm,
    color: Colors.onSurfaceVariant,
    marginTop: Spacing.xs,
    maxWidth: SWATCH_SIZE + 16,
    textAlign: 'center',
  },
  itemLabelActive: { color: Colors.onSurface, fontWeight: '700' },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
});
