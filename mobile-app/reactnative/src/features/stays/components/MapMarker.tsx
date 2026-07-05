import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import { formatMoney } from '../constants/stays.constants';
import type { Currency } from '../types';

interface Props {
  priceMinor: number;
  currency: Currency;
  soldOut?: boolean;
  active?: boolean;
  onPress?: () => void;
}

/**
 * A price pin used on the results map. Sold-out pins render red (greyed-style)
 * like Booking.com; the selected pin is highlighted. This is a self-contained
 * pill (no native map dependency) so it composes into any map host.
 */
export default function MapMarker({ priceMinor, currency, soldOut, active, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.pin, active && styles.pinActive, soldOut && styles.pinSoldOut, shadow2]}
    >
      <Text style={[styles.label, (active || soldOut) && styles.labelOn]}>
        {soldOut ? 'Sold out' : formatMoney(priceMinor, currency, { compact: true })}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pin: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pinActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  pinSoldOut: { backgroundColor: Colors.error, borderColor: Colors.error },
  label: { ...Typography.labelSm, color: Colors.primary, fontWeight: '800' as const },
  labelOn: { color: Colors.white },
});
