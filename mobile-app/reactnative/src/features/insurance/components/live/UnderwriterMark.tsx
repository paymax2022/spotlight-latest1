// ── Insurance (live) — who actually carries the risk ────────────────────────
// Paymax does not underwrite. Ten real insurers do (AIICO, Sovereign Trust,
// Coronation, Sanlam, SanlamAllianz, Leadway, Bastion Health, Goxi, Tangerine,
// MyCoverGenius), and a person is entitled to know whose paper their cover is on
// before they pay — so this mark appears on every card, quote and policy.
//
// `meta.logo` exists for 38 of 68 products; the rest fall back to the insurer's
// initials rather than a broken image.

import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { InsuranceColors } from '../../constants/insurance.constants';

export function initialsFor(name: string): string {
  const words = String(name ?? '')
    .replace(/\b(insurance|plc|ltd|limited|company|assurance|nigeria|microinsurance|health)\b/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export default function UnderwriterMark({
  underwriter,
  logoUrl,
  size = 28,
}: {
  underwriter: string;
  logoUrl?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = !!logoUrl && !failed;

  return (
    <View
      style={[
        styles.mark,
        { width: size, height: size, borderRadius: Radius.sm },
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: logoUrl as string }}
          style={{ width: size, height: size, borderRadius: Radius.sm }}
          resizeMode="contain"
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text style={[styles.initials, { fontSize: Math.round(size * 0.38) }]}>
          {initialsFor(underwriter)}
        </Text>
      )}
    </View>
  );
}

/** Inline "Underwritten by X · via MyCover.ai" disclosure row. */
export function UnderwriterRow({
  underwriter,
  logoUrl,
  aggregator = 'MyCover.ai',
  compact = false,
}: {
  underwriter: string;
  logoUrl?: string | null;
  aggregator?: string;
  compact?: boolean;
}) {
  if (!underwriter) return null;
  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <UnderwriterMark underwriter={underwriter} logoUrl={logoUrl} size={compact ? 22 : 28} />
      {/* Two lines, not one: a truncated "Sovereign Trust Insuranc…" hides the
          very fact this row exists to disclose. */}
      <Text style={compact ? styles.textCompact : styles.text} numberOfLines={compact ? 1 : 2}>
        {compact ? underwriter : `Underwritten by ${underwriter}`}
        {compact ? null : <Text style={styles.via}>{`  ·  via ${aggregator}`}</Text>}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    backgroundColor: Colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: { ...Typography.labelSm, color: InsuranceColors.brand, fontWeight: '700' as const },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  rowCompact: { backgroundColor: Colors.transparent, paddingHorizontal: 0, paddingVertical: 0 },
  text: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  textCompact: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  via: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
