// FOOD-UAT-C-005: per-item modifier sheet. Required groups with a single
// choice render as radios; everything else as checkboxes. The running unit
// price updates as options are picked. Selection rules live in ../modifiers.

import React from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import type { MenuItem, CartModifier } from '../types';
import { formatNaira } from '../utils';
import {
  effectiveMax, effectiveMin, isAvailableOption, isSingleChoice, resolveSelection,
  runningUnitPriceKobo, toggleSelection, validateSelection,
} from '../modifiers';

export default function ModifierSheet({
  item,
  onClose,
  onConfirm,
}: {
  item: MenuItem | null;
  onClose: () => void;
  onConfirm: (item: MenuItem, modifiers: CartModifier[]) => void;
}) {
  const groups = item?.modifierGroups ?? [];
  // Selection per group, so a radio swap never disturbs another group's picks.
  const [sel, setSel] = React.useState<Record<string, string[]>>({});
  const [showErrors, setShowErrors] = React.useState(false);
  React.useEffect(() => {
    setSel({});
    setShowErrors(false);
  }, [item?.id]);

  if (!item) return null;
  const selectedIds = Object.values(sel).flat();
  const errors = validateSelection(groups, selectedIds);
  const unit = runningUnitPriceKobo(item.priceKobo, groups, selectedIds);

  const confirm = () => {
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      return;
    }
    onConfirm(item, resolveSelection(groups, selectedIds));
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} accessibilityLabel="Close options" />
      <View style={st.sheet} testID="modifier-sheet">
        <View style={st.head}>
          <View style={{ flex: 1 }}>
            <Text style={st.title} numberOfLines={2}>{item.name}</Text>
            <Text style={st.base}>From {formatNaira(item.priceKobo)}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
            <Icons.X size={20} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
          </Pressable>
        </View>
        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          {groups.map((g) => {
            const single = isSingleChoice(g);
            const picked = sel[g.id] ?? [];
            const min = effectiveMin(g);
            const max = effectiveMax(g);
            return (
              <View key={g.id} style={st.group}>
                <View style={st.groupHead}>
                  <Text style={st.groupName}>{g.name}</Text>
                  <Text style={[st.badge, g.required && st.badgeReq]}>
                    {g.required ? 'Required' : 'Optional'}
                  </Text>
                </View>
                <Text style={st.hint}>
                  {single ? 'Pick 1' : min > 0 ? `Pick ${min}–${max}` : `Pick up to ${max}`}
                </Text>
                {showErrors && errors[g.id] ? <Text style={st.error}>{errors[g.id]}</Text> : null}
                {g.options.map((o) => {
                  const on = picked.includes(o.id);
                  const disabled = !isAvailableOption(o);
                  return (
                    <Pressable
                      key={o.id}
                      disabled={disabled}
                      onPress={() => setSel((s) => ({ ...s, [g.id]: toggleSelection(g, s[g.id] ?? [], o.id) }))}
                      style={[st.opt, disabled && { opacity: 0.4 }]}
                      accessibilityRole={single ? 'radio' : 'checkbox'}
                      accessibilityState={{ checked: on, disabled }}
                      accessibilityLabel={o.name}
                    >
                      <View style={[single ? st.radio : st.check, on && st.on]}>
                        {on ? (single ? <View style={st.dot} /> : <Icons.Check size={12} color={Colors.white} strokeWidth={3} />) : null}
                      </View>
                      <Text style={st.optName}>{o.name}{disabled ? ' (unavailable)' : ''}</Text>
                      {o.priceDeltaKobo > 0 ? <Text style={st.delta}>+{formatNaira(o.priceDeltaKobo)}</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
        <Pressable onPress={confirm} style={st.cta} accessibilityRole="button" accessibilityLabel="Add to cart">
          <Text style={st.ctaText}>Add to cart · {formatNaira(unit)}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: Colors.white, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  base: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  group: { marginBottom: Spacing.md },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupName: { ...Typography.labelLg, color: Colors.onSurface },
  badge: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  badgeReq: { color: Colors.error },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: 4 },
  error: { ...Typography.labelSm, color: Colors.error, marginBottom: 4 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: 10 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  check: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  on: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.white },
  optName: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  delta: { ...Typography.labelMd, color: Colors.secondary },
  cta: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 14, alignItems: 'center' },
  ctaText: { ...Typography.labelLg, color: Colors.white },
});
