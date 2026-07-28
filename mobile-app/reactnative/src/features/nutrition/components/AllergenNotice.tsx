import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { AllergenDeclaration } from '../types';

// ─── Allergen chip ────────────────────────────────────────────────────────────
type Tone = 'contains' | 'maybe' | 'free';

function Chip({ label, tone }: { label: string; tone: Tone }) {
  const style =
    tone === 'contains' ? styles.chipContains : tone === 'free' ? styles.chipFree : styles.chipMaybe;
  const textStyle =
    tone === 'contains'
      ? styles.chipTextContains
      : tone === 'free'
      ? styles.chipTextFree
      : styles.chipTextMaybe;
  return (
    <View style={[styles.chip, style]}>
      <Text style={[styles.chipText, textStyle]}>{label}</Text>
    </View>
  );
}

interface Props {
  allergens?: AllergenDeclaration[];
  /** Title visible above the notice (defaults to "Allergens"). */
  title?: string;
}

/**
 * VISUALLY SEPARATE, prominent allergen notice — deliberately styled apart from
 * the macro card (heavier border, alert iconography) so allergen risk is never
 * mistaken for nutrition trivia.
 *
 * Rules:
 *  • No attested allergens at all → amber "not confirmed" warning.
 *  • Vendor CONTAINS  → red chips (highest prominence).
 *  • Vendor FREE_FROM → green chips, ONLY when attested by a vendor.
 *  • AI suggestions   → low-trust "possible" (amber MAY_CONTAIN) chips, never
 *    treated as authoritative.
 */
export default function AllergenNotice({ allergens, title = 'Allergens' }: Props) {
  const list = allergens ?? [];
  const vendorContains = list.filter((a) => a.declaration_type === 'CONTAINS' && a.source === 'VENDOR');
  // FREE_FROM only counts as reassurance when a vendor attested it.
  const vendorFree = list.filter((a) => a.declaration_type === 'FREE_FROM' && a.source === 'VENDOR');
  const possible = list.filter(
    (a) => a.declaration_type === 'MAY_CONTAIN' || (a.declaration_type === 'CONTAINS' && a.source === 'AI'),
  );

  const hasAttested = vendorContains.length > 0 || vendorFree.length > 0;

  // No vendor attestation → loud, honest warning. This is the safe default.
  if (!hasAttested) {
    return (
      <View style={[styles.wrap, styles.wrapWarn]}>
        <View style={styles.headerRow}>
          <TriangleAlert size={18} color={Colors.onWarning} strokeWidth={2.2} />
          <Text style={[styles.heading, { color: Colors.onWarning }]}>{title}</Text>
        </View>
        <Text style={styles.warnText}>
          Allergen info not confirmed — may contain allergens. Check with the restaurant before
          ordering if you have an allergy.
        </Text>
        {possible.length > 0 ? (
          <>
            <Text style={styles.subLabel}>AI thinks it might contain (unconfirmed):</Text>
            <View style={styles.chipRow}>
              {possible.map((a, i) => (
                <Chip key={`${a.allergen}-${i}`} label={`possibly ${a.allergen}`} tone="maybe" />
              ))}
            </View>
          </>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.wrap, vendorContains.length > 0 ? styles.wrapDanger : styles.wrapOk]}>
      <View style={styles.headerRow}>
        {vendorContains.length > 0 ? (
          <ShieldAlert size={18} color={Colors.error} strokeWidth={2.2} />
        ) : (
          <ShieldCheck size={18} color={Colors.tertiaryContainer} strokeWidth={2.2} />
        )}
        <Text
          style={[
            styles.heading,
            { color: vendorContains.length > 0 ? Colors.error : Colors.tertiaryContainer },
          ]}
        >
          {title}
        </Text>
        <Text style={styles.attestNote}>vendor-attested</Text>
      </View>

      {vendorContains.length > 0 ? (
        <>
          <Text style={[styles.subLabel, { color: Colors.error }]}>Contains</Text>
          <View style={styles.chipRow}>
            {vendorContains.map((a, i) => (
              <Chip key={`c-${a.allergen}-${i}`} label={a.allergen} tone="contains" />
            ))}
          </View>
        </>
      ) : null}

      {vendorFree.length > 0 ? (
        <>
          <Text style={[styles.subLabel, { color: Colors.tertiaryContainer }]}>Free from</Text>
          <View style={styles.chipRow}>
            {vendorFree.map((a, i) => (
              <Chip
                key={`f-${a.allergen}-${i}`}
                label={`${a.allergen}${a.cross_contamination_ack ? '' : ' *'}`}
                tone="free"
              />
            ))}
          </View>
        </>
      ) : null}

      {possible.length > 0 ? (
        <>
          <Text style={styles.subLabel}>AI flagged as possible (unconfirmed)</Text>
          <View style={styles.chipRow}>
            {possible.map((a, i) => (
              <Chip key={`p-${a.allergen}-${i}`} label={`possibly ${a.allergen}`} tone="maybe" />
            ))}
          </View>
        </>
      ) : null}

      {vendorFree.some((a) => !a.cross_contamination_ack) ? (
        <Text style={styles.note}>* Cross-contamination not guaranteed.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1.5,
    gap: Spacing.xs,
  },
  // Distinct, prominent treatments — visibly NOT a macro card.
  wrapWarn: { backgroundColor: Colors.iconBgGold, borderColor: Colors.gold },
  wrapDanger: { backgroundColor: Colors.errorContainer, borderColor: Colors.error },
  wrapOk: { backgroundColor: Colors.iconBgTeal, borderColor: Colors.tertiaryContainer },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heading: { ...Typography.labelLg },
  attestNote: { ...Typography.caption, color: Colors.onSurfaceVariant, marginLeft: 'auto' },
  warnText: { ...Typography.bodySm, color: Colors.onWarning },
  subLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 4 },
  note: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full, borderWidth: 1 },
  chipContains: { backgroundColor: Colors.white, borderColor: Colors.error },
  chipFree: { backgroundColor: Colors.white, borderColor: Colors.tertiaryContainer },
  chipMaybe: { backgroundColor: Colors.surfaceContainerLow, borderColor: Colors.gold },
  chipText: { ...Typography.labelSm },
  chipTextContains: { color: Colors.error },
  chipTextFree: { color: Colors.tertiaryContainer },
  chipTextMaybe: { color: Colors.onWarning },
});
