import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';

interface Props {
  /** The value the QR would encode (e.g. a credential verify URL). */
  value: string;
  size?: number;
}

/**
 * Dependency-free QR placeholder. Renders a deterministic blocky grid derived
 * from the value's characters so different credentials look distinct, plus the
 * encoded value beneath. In the live app this is swapped for a real QR library
 * (e.g. react-native-qrcode-svg) without changing call sites.
 */
export default function QrPlaceholder({ value, size = 168 }: Props) {
  const cells = 11;
  const cell = Math.floor(size / cells);
  // Deterministic bit pattern from the string.
  const bits: boolean[] = [];
  let seed = 0;
  for (let i = 0; i < value.length; i++) seed = (seed * 31 + value.charCodeAt(i)) >>> 0;
  for (let i = 0; i < cells * cells; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    bits.push((seed >> 16) % 2 === 0);
  }
  const isFinder = (r: number, c: number) =>
    (r < 3 && c < 3) || (r < 3 && c >= cells - 3) || (r >= cells - 3 && c < 3);

  return (
    <View style={styles.wrap}>
      <View style={[styles.grid, { width: cell * cells, height: cell * cells }]}>
        {Array.from({ length: cells }).map((_, r) => (
          <View key={r} style={styles.row}>
            {Array.from({ length: cells }).map((__, c) => {
              const on = isFinder(r, c) ? (r % 2 === 0 || c % 2 === 0) : bits[r * cells + c];
              return <View key={c} style={{ width: cell, height: cell, backgroundColor: on ? Colors.onSurface : Colors.white }} />;
            })}
          </View>
        ))}
      </View>
      <Text style={styles.caption} numberOfLines={1}>{value}</Text>
      <Text style={styles.hint}>Scan to verify · mock QR (real QR in production)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8 },
  grid: { backgroundColor: Colors.white, borderRadius: Radius.sm, padding: 4, overflow: 'hidden' },
  row: { flexDirection: 'row' },
  caption: { ...Typography.caption, color: Colors.onSurfaceVariant, maxWidth: 240 },
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
