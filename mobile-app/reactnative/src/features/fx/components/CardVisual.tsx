import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Snowflake, Wifi } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow3 } from '@/constants/shadows';
import { CARD_GRADIENTS, CURRENCIES } from '../constants/fx.constants';
import type { Card, CardSensitive } from '../types/fx.types';

interface Props {
  card: Card;
  sensitive?: CardSensitive | null;   // when revealed, show full PAN/CVV
  compact?: boolean;
}

const BRAND_LABEL: Record<Card['brand'], string> = { visa: 'VISA', mastercard: 'Mastercard', verve: 'Verve' };

/**
 * Card art (DESIGN-Mobile.md gradient surface + Level-3 shadow). Mirrors the
 * BalanceCard gradient/overlay approach; new because no card-art component existed.
 */
export default function CardVisual({ card, sensitive, compact }: Props) {
  const meta = CURRENCIES[card.currency];
  const frozen = card.status === 'frozen';
  const pan = sensitive ? sensitive.pan : `•••• •••• •••• ${card.last4}`;
  const exp = sensitive ? sensitive.expiry : `${String(card.expMonth).padStart(2, '0')}/${card.expYear}`;
  const cvv = sensitive ? sensitive.cvv : '•••';

  return (
    <LinearGradient
      colors={CARD_GRADIENTS[card.color] ?? CARD_GRADIENTS.slate ?? ['#334155', '#0f172a']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, compact && styles.compact, shadow3, frozen && styles.frozen]}
    >
      <View style={styles.topRow}>
        <View>
          <Text style={styles.label}>{card.label}</Text>
          <Text style={styles.currency}>{meta?.flag ?? ''} {card.currency} · Virtual</Text>
        </View>
        {frozen
          ? <View style={styles.frozenPill}><Snowflake size={12} color={Colors.onPrimary} strokeWidth={2} /><Text style={styles.frozenText}>Frozen</Text></View>
          : <Wifi size={20} color="rgba(255,255,255,0.7)" strokeWidth={2} style={styles.contactless} />}
      </View>

      <Text style={[styles.pan, compact && styles.panCompact]}>{pan}</Text>

      <View style={styles.bottomRow}>
        <View>
          <Text style={styles.metaLabel}>Card holder</Text>
          <Text style={styles.metaValue}>{card.cardholderName}</Text>
        </View>
        <View>
          <Text style={styles.metaLabel}>Expires</Text>
          <Text style={styles.metaValue}>{exp}</Text>
        </View>
        {!compact ? (
          <View>
            <Text style={styles.metaLabel}>CVV</Text>
            <Text style={styles.metaValue}>{cvv}</Text>
          </View>
        ) : null}
        <Text style={styles.brand}>{BRAND_LABEL[card.brand]}</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md, overflow: 'hidden', minHeight: 200, justifyContent: 'space-between' },
  compact: { minHeight: 150, padding: Spacing.md },
  frozen: { opacity: 0.85 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  label: { ...Typography.titleMd, color: Colors.onPrimary },
  currency: { ...Typography.labelSm, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  contactless: { transform: [{ rotate: '90deg' }] },
  frozenPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  frozenText: { ...Typography.labelSm, color: Colors.onPrimary },
  pan: { ...Typography.titleLg, color: Colors.onPrimary, letterSpacing: 2 },
  panCompact: { ...Typography.titleMd, letterSpacing: 1.5 },
  bottomRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Spacing.sm },
  metaLabel: { ...Typography.caption, color: 'rgba(255,255,255,0.6)' },
  metaValue: { ...Typography.labelMd, color: Colors.onPrimary, marginTop: 1 },
  brand: { ...Typography.labelLg, color: Colors.onPrimary, fontStyle: 'italic' },
});
