// Bottom sheet for choosing ONE priced option within a Film Academy area of
// interest, with or without boarding. Display-only pricing (NAIRA): the server
// re-prices every selection from the database when the application is posted.
//
// Built on react-native's Modal with a bottom-anchored panel, the same pattern
// as the app's other sheets (ModifierSheet, CurrencyPickerSheet), so it works
// identically on react-native-web.

import React from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Clock, Info, X, BedDouble } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { optionPrice } from '../optionPricing';
import { offersBoarding } from '../picks';
import type { FilmAcademyAreaOption, FilmAcademyInterestArea } from '../types';

export interface AreaOptionSheetProps {
  area: FilmAcademyInterestArea;
  initial?: { option_id: string; boarding: boolean };
  onSelect(p: { option: FilmAcademyAreaOption; boarding: boolean }): void;
  onClose(): void;
}

const naira = (n: number) => `₦${n.toLocaleString('en-NG')}`;

export default function AreaOptionSheet({ area, initial, onSelect, onClose }: AreaOptionSheetProps) {
  const insets = useSafeAreaInsets();
  const options = area.options ?? [];
  const boardingOffered = offersBoarding(area);

  const [boarding, setBoarding] = React.useState<boolean>(
    Boolean(initial?.boarding) && boardingOffered,
  );
  // A single-option area is pre-selected: there is nothing to choose between.
  const [selectedId, setSelectedId] = React.useState<string | null>(
    initial?.option_id ?? (options.length === 1 ? options[0].id : null),
  );

  // `area` is live: a refetch can remove the chosen option or withdraw boarding
  // while the sheet is open. Drop state that no longer matches, never keep it.
  React.useEffect(() => {
    if (selectedId && !options.some((o) => o.id === selectedId)) setSelectedId(null);
    if (boarding && !boardingOffered) setBoarding(false);
  }, [options, selectedId, boarding, boardingOffered]);

  const selected = options.find((o) => o.id === selectedId) ?? null;
  const selectedPrice = selected ? optionPrice(selected, boarding) : null;
  const canSelect = selected !== null && selectedPrice !== null;

  const switchBoarding = (next: boolean) => {
    setBoarding(next);
    // An option that cannot be taken with boarding must not stay silently selected.
    if (next && selected && selected.price_with_boarding_ngn === null) setSelectedId(null);
  };

  const confirm = () => {
    if (selected && canSelect) onSelect({ option: selected, boarding });
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={st.root}>
        <Pressable
          style={st.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={`Close ${area.label} options`}
        />
        <View
          style={[st.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}
          accessibilityViewIsModal
          testID="area-option-sheet"
        >
          <View style={st.handle} />

          <View style={st.head}>
            <View style={st.headText}>
              <Text style={st.title} accessibilityRole="header">{area.label}</Text>
              {!!area.description && <Text style={st.desc}>{area.description}</Text>}
            </View>
            <Pressable
              onPress={onClose}
              style={st.close}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={22} color={Colors.onSurfaceVariant} />
            </Pressable>
          </View>

          {options.length === 0 ? (
            <View style={st.empty}>
              <Info size={22} color={Colors.onSurfaceVariant} />
              <Text style={st.emptyText}>Pricing for {area.label} is coming soon.</Text>
            </View>
          ) : (
            <>
              {boardingOffered ? (
                <View style={st.track} accessibilityRole="tablist">
                  {([false, true] as const).map((b) => {
                    const active = boarding === b;
                    const label = b ? 'With boarding' : 'Without boarding';
                    return (
                      <Pressable
                        key={label}
                        onPress={() => switchBoarding(b)}
                        style={[st.seg, active && st.segActive]}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={label}
                      >
                        {b && <BedDouble size={16} color={active ? Colors.primary : Colors.onSurfaceVariant} />}
                        <Text style={[st.segText, active && st.segTextActive]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <View style={st.infoRow}>
                  <Info size={16} color={Colors.onSurfaceVariant} />
                  <Text style={st.infoText}>Boarding is not offered for this area.</Text>
                </View>
              )}

              <ScrollView
                style={st.list}
                contentContainerStyle={st.listContent}
                showsVerticalScrollIndicator={false}
                accessibilityRole="radiogroup"
              >
                {options.map((o) => (
                  <OptionCard
                    key={o.id}
                    option={o}
                    boarding={boarding}
                    selected={o.id === selectedId}
                    onPress={() => setSelectedId(o.id)}
                  />
                ))}
              </ScrollView>

              <View style={st.footer}>
                {canSelect && (
                  <View style={st.choiceRow}>
                    <Text style={st.choiceLabel} numberOfLines={2}>
                      {selected!.label} · {boarding ? 'with boarding' : 'without boarding'}
                    </Text>
                    <Text style={st.choicePrice}>{naira(selectedPrice!)}</Text>
                  </View>
                )}
                <PrimaryButton label="Select" onPress={confirm} disabled={!canSelect} />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function OptionCard({ option, boarding, selected, onPress }: {
  option: FilmAcademyAreaOption; boarding: boolean; selected: boolean; onPress: () => void;
}) {
  const price = optionPrice(option, boarding);
  const unavailable = price === null;
  const withB = option.price_with_boarding_ngn;
  const extra = withB !== null ? withB - option.price_no_boarding_ngn : null;

  const a11y = unavailable
    ? `${option.label}${option.duration_label ? `, ${option.duration_label}` : ''}, boarding not available`
    : `${option.label}${option.duration_label ? `, ${option.duration_label}` : ''}, ${naira(price)} ${
        boarding ? 'with boarding' : 'without boarding'
      }`;

  return (
    <Pressable
      onPress={onPress}
      disabled={unavailable}
      style={({ pressed }) => [
        st.card,
        selected && !unavailable && st.cardOn,
        unavailable && st.cardOff,
        pressed && !unavailable && st.cardPressed,
      ]}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected && !unavailable, disabled: unavailable }}
      accessibilityLabel={a11y}
    >
      <View style={[st.radio, selected && !unavailable && st.radioOn]}>
        {selected && !unavailable && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}
      </View>

      <View style={st.cardBody}>
        <Text style={st.optLabel}>{option.label}</Text>
        {!!option.duration_label && (
          <View style={st.metaRow}>
            <Clock size={13} color={Colors.onSurfaceVariant} />
            <Text style={st.meta}>{option.duration_label}</Text>
          </View>
        )}
        {unavailable ? (
          <Text style={st.meta}>Boarding not available</Text>
        ) : !boarding && extra !== null ? (
          <Text style={st.hint}>
            {extra > 0 ? `+${naira(extra)} with boarding` : 'Boarding at no extra cost'}
          </Text>
        ) : null}
      </View>

      <Text style={[st.price, unavailable && st.priceOff]}>
        {unavailable ? '—' : naira(price)}
      </Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  root:      { flex: 1, justifyContent: 'flex-end' },
  backdrop:  { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,28,48,0.45)' },
  sheet:     { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl,
               borderTopRightRadius: Radius.xl, paddingTop: Spacing.sm, paddingHorizontal: Spacing.md,
               gap: Spacing.md, maxHeight: '88%' },
  handle:    { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.full,
               backgroundColor: Colors.outlineVariant },
  head:      { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  headText:  { flex: 1, gap: Spacing.xs, paddingTop: Spacing.xs },
  title:     { ...Typography.titleLg, color: Colors.onSurface },
  desc:      { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  close:     { width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
               marginRight: -Spacing.sm, marginTop: -Spacing.xs },

  track:     { flexDirection: 'row', backgroundColor: Colors.surfaceContainerHigh,
               borderRadius: Radius.md, padding: Spacing.xs },
  seg:       { flex: 1, minHeight: 48, flexDirection: 'row', gap: Spacing.xs, alignItems: 'center',
               justifyContent: 'center', borderRadius: Radius.DEFAULT, paddingHorizontal: Spacing.sm,
               borderWidth: 1, borderColor: Colors.transparent },
  segActive: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.primary },
  segText:   { ...Typography.labelMd, color: Colors.onSurfaceVariant, textAlign: 'center', flexShrink: 1 },
  segTextActive: { color: Colors.primary, fontWeight: '700' as const },

  infoRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 48,
               backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md,
               paddingHorizontal: Spacing.md },
  infoText:  { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },

  list:        { flexGrow: 0 },
  listContent: { gap: Spacing.sm, paddingBottom: Spacing.xs },

  card:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 72,
               paddingVertical: Spacing.md, paddingHorizontal: Spacing.md, borderRadius: Radius.md,
               borderWidth: 1.5, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  cardOn:    { borderColor: Colors.primary, backgroundColor: Colors.iconBgPurple },
  cardOff:   { opacity: 0.55, backgroundColor: Colors.surfaceContainerLow },
  cardPressed: { opacity: 0.85 },
  radio:     { width: 24, height: 24, borderRadius: Radius.full, borderWidth: 2, borderColor: Colors.outline,
               alignItems: 'center', justifyContent: 'center' },
  radioOn:   { borderColor: Colors.primary, backgroundColor: Colors.primary },
  cardBody:  { flex: 1, gap: 2 },
  optLabel:  { ...Typography.labelLg, color: Colors.onSurface },
  metaRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  meta:      { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  hint:      { ...Typography.labelSm, color: Colors.secondary, marginTop: 2 },
  price:     { ...Typography.titleMd, color: Colors.onSurface },
  priceOff:  { color: Colors.onSurfaceVariant },

  footer:    { gap: Spacing.sm, paddingTop: Spacing.xs },
  choiceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  choiceLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  choicePrice: { ...Typography.labelLg, color: Colors.onSurface },

  empty:     { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  emptyText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
