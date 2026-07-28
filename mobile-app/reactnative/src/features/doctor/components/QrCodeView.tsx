import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  payload:          string;   // QR content (encoded into the deterministic grid)
  verificationCode: string;   // human-readable code shown under the QR block
  size?:            number;    // overall QR block size (px)
}

// New component: a dependency-free QR placeholder. No QR library is allowed, so a
// deterministic grid of styled Views (seeded from the payload string) renders a
// scannable-looking block plus the verification code. Nothing in the barrel draws
// a QR / verification block, so this is genuinely new (token colours only).
const CELLS = 11; // grid resolution

export default function QrCodeView({ payload, verificationCode, size = 176 }: Props) {
  const grid = useMemo(() => {
    const cells: boolean[] = [];
    const seed = payload || verificationCode || 'rx';
    for (let i = 0; i < CELLS * CELLS; i++) {
      const ch = seed.charCodeAt(i % seed.length);
      cells.push(((ch + i * 31 + (i % 7) * 13) % 5) > 1);
    }
    return cells;
  }, [payload, verificationCode]);

  const cell = Math.floor(size / CELLS);

  return (
    <View style={styles.wrap}>
      <View style={styles.frame}>
        <View style={[styles.grid, { width: cell * CELLS, height: cell * CELLS }]}>
          {grid.map((on, i) => (
            <View key={i} style={[{ width: cell, height: cell }, on ? styles.cellOn : styles.cellOff]} />
          ))}
        </View>
      </View>
      <Text style={styles.codeLabel}>Verification code</Text>
      <Text style={styles.code} accessibilityLabel={`Verification code ${verificationCode}`}>{verificationCode}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:      { alignItems: 'center', gap: Spacing.xs },
  frame:     { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  grid:      { flexDirection: 'row', flexWrap: 'wrap' },
  cellOn:    { backgroundColor: Colors.onSurface },
  cellOff:   { backgroundColor: Colors.white },
  codeLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  code:      { ...Typography.titleMd, color: Colors.primary, fontWeight: '700', letterSpacing: 2 },
});
