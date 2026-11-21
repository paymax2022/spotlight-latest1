import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Eye, EyeOff, QrCode } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow3 } from '@/constants/tokens';

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
  /** Overrides the "Total Balance" caption (e.g. "NGN Wallet"). */
  label?:       string;
  /**
   * Makes the currency pill a real toggle. Pass the codes the holder actually
   * has a wallet in, together with onSelectCurrency; `currency` is the selected
   * one. Omit both and the pill keeps its original static appearance, so the
   * screens that were already using this card are untouched.
   */
  currencies?:  string[];
  onSelectCurrency?: (currency: string) => void;
  /**
   * True when no balance source could produce a figure. Renders a placeholder
   * instead of a number — ₦0.00 would read as a real empty wallet and mask
   * money the user actually has.
   */
  balanceUnavailable?: boolean;
  /** One-line hint under the placeholder (e.g. "pull down to refresh"). */
  unavailableHint?:   string;
  /**
   * Home's wallet strip: no currency pill, no QR pip, no divider, and the quick
   * actions as inline icon+label chips instead of icon-over-label columns.
   * Off by default so the wallet, FX and mobility screens keep the full card.
   */
  compact?: boolean;
}

// Minor-unit symbols for the currencies a wallet can be denominated in. The card
// used to hardcode "₦", so any non-NGN balance rendered with the wrong symbol —
// a $12.00 wallet read as ₦12.00.
const SYMBOLS: Record<string, string> = {
  NGN: '₦', USD: '$', EUR: '€', GBP: '£', GHS: '₵', KES: 'KSh', XAF: 'FCFA', ZAR: 'R',
};

function fmt(n: number, currency: string): string {
  const body = n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = SYMBOLS[currency] ?? '';
  // KES/XAF read better with the code trailing; everything else takes a prefix.
  if (currency === 'KES' || currency === 'XAF') return `${body} ${symbol}`;
  return symbol ? `${symbol}${body}` : `${body} ${currency}`;
}

// The compact strip sets the cents in a lighter size, so the formatted string is
// split on its LAST '.' — the "1 234 KES" suffix form has no decimal point and
// simply comes back whole.
function splitCents(text: string): [string, string] {
  const i = text.lastIndexOf('.');
  return i === -1 ? [text, ''] : [text.slice(0, i), text.slice(i)];
}

export default function BalanceCard({
  balance, currency = 'NGN', quickActions, label, currencies, onSelectCurrency,
  balanceUnavailable, unavailableHint, compact,
}: Props) {
  const [hidden, setHidden] = useState(false);
  // Interactive only when the caller supplies both the options and the handler —
  // otherwise the pill would look tappable and silently do nothing.
  const toggleable = Boolean(currencies && currencies.length > 1 && onSelectCurrency);
  const amountText = balanceUnavailable ? '——' : hidden ? '••••••' : fmt(balance, currency);
  const [major, minor] = compact ? splitCents(amountText) : [amountText, ''];

  return (
    <LinearGradient
      colors={['#340075', '#4C1D95', '#0051D5']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, shadow3, compact && styles.cardCompact]}
    >
      {/* Decorative ring behind the content, as in the prototype wallet strip. */}
      {compact ? <View style={styles.ring} pointerEvents="none" /> : null}

      {/* Top row */}
      <View style={styles.topRow}>
        <View>
          <Text style={[styles.balanceLabel, compact && styles.balanceLabelCompact]}>{label ?? 'Total Balance'}</Text>
          <View style={styles.amountRow}>
            <Text style={styles.amount}>{major}{minor ? <Text style={styles.amountCents}>{minor}</Text> : null}</Text>
            {!balanceUnavailable && (
              <Pressable
                onPress={() => setHidden((h) => !h)}
                style={styles.eyeBtn}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={hidden ? 'Show balance' : 'Hide balance'}
              >
                {hidden
                  ? <Eye    size={18} color="rgba(255,255,255,0.7)" />
                  : <EyeOff size={18} color="rgba(255,255,255,0.7)" />
                }
              </Pressable>
            )}
          </View>
          {balanceUnavailable ? (
            <Text style={styles.unavailableHint}>{unavailableHint ?? 'Balance unavailable'}</Text>
          ) : null}
        </View>

        {/* Currency pill + QR. The compact strip drops both: the second currency
            code is decorative unless the caller wires a real toggle, and the QR
            pip carries no onPress — it is chrome, not a control. */}
        {compact ? null : (
        <View style={styles.topRight}>
          {toggleable ? (
            <View style={styles.currencyPill} accessibilityRole="tablist">
              {currencies!.map((code, i) => (
                <React.Fragment key={code}>
                  {i > 0 ? <View style={styles.currencyDivider} /> : null}
                  <Pressable
                    onPress={() => onSelectCurrency!(code)}
                    hitSlop={6}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: code === currency }}
                    accessibilityLabel={`Show ${code} wallet`}
                  >
                    <Text style={[styles.currencyText, code !== currency && styles.currencyAlt]}>{code}</Text>
                  </Pressable>
                </React.Fragment>
              ))}
            </View>
          ) : (
            <View style={styles.currencyPill}>
              <Text style={styles.currencyText}>{currency}</Text>
              <View style={styles.currencyDivider} />
              <Text style={[styles.currencyText, styles.currencyAlt]}>USD</Text>
            </View>
          )}
          <Pressable style={styles.qr} accessibilityRole="button" accessibilityLabel="Show QR code">
            <QrCode size={20} color="rgba(255,255,255,0.6)" strokeWidth={1.5} />
          </Pressable>
        </View>
        )}
      </View>

      {/* Divider */}
      {compact ? null : <View style={styles.divider} />}

      {/* Quick actions */}
      {compact ? (
        <View style={styles.chipRow}>
          {quickActions.map((action) => (
            <Pressable
              key={action.id}
              onPress={action.onPress}
              style={({ pressed }) => [styles.chip, pressed && styles.actionPressed]}
            >
              {action.icon}
              <Text style={styles.chipLabel}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
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
      )}
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
  cardCompact: {
    paddingVertical:  Spacing.md,
  },
  // The prototype's wallet carries one thin ring, top-right, cut off by the card.
  ring: {
    position:        'absolute',
    right:           -70,
    top:             -60,
    width:           190,
    height:          190,
    borderRadius:    95,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.12)',
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
  // Compact label follows the prototype's eyebrow: small, uppercase, tracked.
  balanceLabelCompact: {
    fontSize:      10,
    lineHeight:    14,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color:         'rgba(255,255,255,0.62)',
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
  // The prototype sets the cents at roughly two thirds of the major figure.
  amountCents: {
    fontSize:      19,
    lineHeight:    36,
    letterSpacing: -0.3,
    color:         'rgba(255,255,255,0.72)',
  },
  eyeBtn: {
    padding: 4,
  },
  unavailableHint: {
    ...Typography.caption,
    color:     'rgba(255,255,255,0.7)',
    marginTop: 2,
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
  // Compact actions: ghost chips with the icon inline, left of the label.
  chipRow: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           Spacing.sm,
    marginTop:     Spacing.md,
  },
  chip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.sm,
    borderRadius:      Radius.DEFAULT,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.27)',
    backgroundColor:   'rgba(255,255,255,0.07)',
    paddingVertical:   7,
    paddingHorizontal: Spacing.sm,
  },
  chipLabel: {
    ...Typography.labelSm,
    color: Colors.onPrimary,
  },
});
