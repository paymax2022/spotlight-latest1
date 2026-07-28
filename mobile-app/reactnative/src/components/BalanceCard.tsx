import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Eye, EyeOff, QrCode } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow3 } from '@/constants/shadows';

interface QuickAction {
  id:    string;
  label: string;
  icon:  React.ReactNode;
  onPress: () => void;
}

interface Props {
  balance:      number;
  currency?:    string;
  quickActions: QuickAction[];
}

function fmt(n: number): string {
  return n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BalanceCard({ balance, currency = 'NGN', quickActions }: Props) {
  const [hidden, setHidden] = useState(false);

  return (
    <LinearGradient
      colors={['#340075', '#4C1D95', '#0051D5']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, shadow3]}
    >
      {/* Top row */}
      <View style={styles.topRow}>
        <View>
          <Text style={styles.balanceLabel}>Total Balance</Text>
          <View style={styles.amountRow}>
            <Text style={styles.amount}>{hidden ? '••••••' : `₦${fmt(balance)}`}</Text>
            <Pressable onPress={() => setHidden((h) => !h)} style={styles.eyeBtn} hitSlop={8}>
              {hidden
                ? <Eye    size={18} color="rgba(255,255,255,0.7)" />
                : <EyeOff size={18} color="rgba(255,255,255,0.7)" />
              }
            </Pressable>
          </View>
        </View>

        {/* Currency pill + QR */}
        <View style={styles.topRight}>
          <View style={styles.currencyPill}>
            <Text style={styles.currencyText}>{currency}</Text>
            <View style={styles.currencyDivider} />
            <Text style={[styles.currencyText, styles.currencyAlt]}>USD</Text>
          </View>
          <Pressable style={styles.qr}>
            <QrCode size={20} color="rgba(255,255,255,0.6)" strokeWidth={1.5} />
          </Pressable>
        </View>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Quick actions */}
      <View style={styles.actionsRow}>
        {quickActions.map((action) => (
          <Pressable
            key={action.id}
            onPress={action.onPress}
            style={({ pressed }) => [styles.actionBtn, pressed && styles.actionPressed]}
          >
            <View style={styles.actionIcon}>{action.icon}</View>
            <Text style={styles.actionLabel}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.containerMargin,
    borderRadius:     Radius.xl,
    padding:          Spacing.cardPadding,
    marginBottom:     Spacing.lg,
    overflow:         'hidden',
  },
  topRow: {
    flexDirection:   'row',
    justifyContent:  'space-between',
    alignItems:      'flex-start',
    marginBottom:    Spacing.md,
  },
  balanceLabel: {
    ...Typography.labelSm,
    color:        'rgba(255,255,255,0.7)',
    marginBottom: Spacing.xs,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.sm,
  },
  amount: {
    fontSize:   30,
    fontWeight: '800',
    color:      Colors.onPrimary,
    lineHeight: 36,
    letterSpacing: -0.5,
  },
  eyeBtn: {
    padding: 4,
  },
  topRight: {
    alignItems: 'flex-end',
    gap:        Spacing.sm,
  },
  currencyPill: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius:    Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    gap:             Spacing.xs,
  },
  currencyText: {
    ...Typography.labelSm,
    color: Colors.onPrimary,
  },
  currencyAlt: {
    opacity: 0.6,
  },
  currencyDivider: {
    width:           1,
    height:          10,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  qr: {
    width:           32,
    height:          32,
    borderRadius:    8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  divider: {
    height:          1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginBottom:    Spacing.md,
  },
  actionsRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
  },
  actionBtn: {
    alignItems:  'center',
    gap:         Spacing.xs,
    flex:        1,
  },
  actionPressed: {
    opacity: 0.7,
  },
  actionIcon: {
    width:           44,
    height:          44,
    borderRadius:    Radius.md,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  actionLabel: {
    ...Typography.caption,
    color:     Colors.onPrimary,
    textAlign: 'center',
  },
});
