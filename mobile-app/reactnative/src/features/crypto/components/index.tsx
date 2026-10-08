import { CRYPTO_FEE_LABEL, CRYPTO_STATUS_STYLE, QUOTE_EXPIRY_SECONDS, RISK_STYLE, SIDE_LABEL, VOLATILITY_DISCLOSURE } from '../constants/crypto.constants';
import { useAssets } from '../hooks/useCrypto';
import type { CandlePoint, CryptoAsset, CryptoQuote, CryptoTransactionSummary, Position, RiskRating } from '../types/crypto.types';
import { formatCountdown, formatCrypto, formatFiatObj, formatPct, formatPrice, relativeTime, secondsUntil } from '../utils/cryptoFormatters';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { ArrowDownLeft, ArrowUpRight, Info, Lock, TimerReset, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextStyle, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';


interface AssetIconProps {
  symbol: string;
  color: string;          // asset brand color (server-config, not a design token)
  size?: number;
}

/**
 * Soft-tinted square glyph tile for a crypto asset (DESIGN-Mobile.md → Icon
 * Enclosures: 12px rounded square with a low-opacity tint of the icon's color).
 * The asset's color comes from the (admin-set) asset payload, so it isn't a
 * hard-coded brand token — different assets carry different colors.
 */
export function AssetIcon({ symbol, color, size = 42 }: AssetIconProps) {
  const glyph = symbol.slice(0, 1).toUpperCase();
  return (
    <View
      style={[
        assetIconStyles.box,
        { width: size, height: size, borderRadius: Radius.md, backgroundColor: `${color}1F` },
      ]}
    >
      <Text style={[assetIconStyles.glyph, { color, fontSize: size * 0.42 }]}>{glyph}</Text>
    </View>
  );
}

const assetIconStyles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  glyph: { ...Typography.labelLg, fontWeight: '800' as const },
});

interface AssetRowProps {
  asset: CryptoAsset;
  onPress?: () => void;
}

/** Discovery/list row: glyph · name/symbol · price · 24h change (docs → asset list). */
export function AssetRow({ asset, onPress }: AssetRowProps) {
  const paused = asset.status !== 'active' || !asset.buyEnabled;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${asset.name}, ${formatFiatObj(asset.price)}`}
      style={({ pressed }) => [assetRowStyles.row, pressed && assetRowStyles.pressed]}
    >
      <AssetIcon symbol={asset.symbol} color={asset.iconColor} />
      <View style={assetRowStyles.mid}>
        <Text style={assetRowStyles.name} numberOfLines={1}>{asset.name}</Text>
        <Text style={assetRowStyles.symbol}>{asset.symbol}</Text>
      </View>
      <View style={assetRowStyles.right}>
        <Text style={assetRowStyles.price} numberOfLines={1}>{formatFiatObj(asset.price)}</Text>
        {paused
          ? <Text style={assetRowStyles.paused}>Paused</Text>
          : <PriceChange pct={asset.change24hPct} />}
      </View>
    </Pressable>
  );
}

const assetRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  pressed: { opacity: 0.7 },
  mid: { flex: 1 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  symbol: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  right: { alignItems: 'flex-end', gap: 3 },
  price: { ...Typography.labelLg, color: Colors.onSurface },
  paused: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});

interface CryptoQuoteBreakdownProps {
  quote: CryptoQuote;
  decimals: number;        // asset precision for the crypto amount line
}

/**
 * Itemised order summary + fee transparency for the trade-confirmation screen
 * (docs/crypto/CLAUDE.md → every trade-confirmation screen must show fees +
 * order summary). Every fee is shown explicitly — "never hide fees".
 */
export function CryptoQuoteBreakdown({ quote, decimals }: CryptoQuoteBreakdownProps) {
  const buy = quote.side === 'buy';
  return (
    <View style={cryptoQuoteBreakdownStyles.card}>
      <Row label="Price" value={formatPrice(quote.symbol, quote.allInRate)} />
      <Row label={buy ? 'You receive' : 'You sell'} value={formatCrypto(quote.crypto.amount, quote.symbol, decimals)} emphasis />

      <View style={cryptoQuoteBreakdownStyles.divider} />

      {quote.fees
        .filter((f) => f.amount.amount > 0)
        .map((f) => (
          <Row key={f.type} label={CRYPTO_FEE_LABEL[f.type] ?? f.type} value={formatFiatObj(f.amount)} muted />
        ))}

      <View style={cryptoQuoteBreakdownStyles.divider} />

      <Row
        label={buy ? 'Total to pay' : 'Total you get'}
        value={formatFiatObj(quote.totalFiat)}
        emphasis
      />

      <View style={cryptoQuoteBreakdownStyles.routeNote}>
        <Info size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
        <Text style={cryptoQuoteBreakdownStyles.routeText}>
          Filled at the locked price by our liquidity partner. The final amount can vary slightly if you re-quote after expiry.
        </Text>
      </View>
    </View>
  );
}

function Row({ label, value, emphasis, muted }: { label: string; value: string; emphasis?: boolean; muted?: boolean }) {
  return (
    <View style={cryptoQuoteBreakdownStyles.row}>
      <Text style={[cryptoQuoteBreakdownStyles.label, muted && cryptoQuoteBreakdownStyles.muted]}>{label}</Text>
      <Text style={[cryptoQuoteBreakdownStyles.value, emphasis && cryptoQuoteBreakdownStyles.emphasis, muted && cryptoQuoteBreakdownStyles.mutedValue]}>{value}</Text>
    </View>
  );
}

const cryptoQuoteBreakdownStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  label: { ...Typography.bodyMd, color: Colors.onSurface, flexShrink: 1 },
  value: { ...Typography.labelLg, color: Colors.onSurface, textAlign: 'right', flexShrink: 1 },
  emphasis: { color: Colors.primary },
  muted: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  mutedValue: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 2 },
  routeNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: Colors.surfaceContainer, borderRadius: Radius.md,
    padding: Spacing.sm, marginTop: 2,
  },
  routeText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 16 },
});

interface CryptoSparklineProps {
  data: CandlePoint[];
  width: number;
  height?: number;
  color?: string;
  fill?: boolean;
}

/**
 * Price line/area chart for asset detail + home cards. Pure react-native-svg,
 * mirroring the fx RateSparkline so charting stays consistent across modules.
 * Stroke colour defaults to teal (rising) / error (falling) when not supplied.
 */
export function CryptoSparkline({ data, width, height = 140, color, fill = true }: CryptoSparklineProps) {
  if (!data || data.length < 2) return <View style={{ width, height }} />;

  const values = data.map((d) => d.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 6;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const points = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * innerW;
    const y = pad + (1 - (d.price - min) / range) * innerH;
    return { x, y };
  });

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${points[points.length - 1].x.toFixed(1)} ${height} L ${points[0].x.toFixed(1)} ${height} Z`;
  const rising = values[values.length - 1] >= values[0];
  const stroke = color ?? (rising ? Colors.teal : Colors.error);

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="cryptoSpark" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={stroke} stopOpacity={0.18} />
          <Stop offset="1" stopColor={stroke} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {fill ? <Path d={area} fill="url(#cryptoSpark)" /> : null}
      <Path d={line} stroke={stroke} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

interface CryptoStatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

/**
 * Pill status chip for crypto order/transaction statuses (mirrors fx
 * TxStatusBadge). Styling comes from CRYPTO_STATUS_STYLE (design tokens only).
 */
export function CryptoStatusBadge({ status, size = 'md' }: CryptoStatusBadgeProps) {
  const style = CRYPTO_STATUS_STYLE[status] ?? CRYPTO_STATUS_STYLE.Processing;
  return (
    <View style={[cryptoStatusBadgeStyles.pill, size === 'sm' && cryptoStatusBadgeStyles.pillSm, { backgroundColor: style.bg }]}>
      <View style={[cryptoStatusBadgeStyles.dot, { backgroundColor: style.fg }]} />
      <Text style={[cryptoStatusBadgeStyles.label, size === 'sm' && cryptoStatusBadgeStyles.labelSm, { color: style.fg }]}>{style.label}</Text>
    </View>
  );
}

const cryptoStatusBadgeStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  pillSm: { paddingVertical: 3, paddingHorizontal: 7 },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  label: { ...Typography.labelSm, fontWeight: '600' as const },
  labelSm: { ...Typography.caption, fontWeight: '600' as const },
});

interface CryptoTransactionRowProps {
  tx: CryptoTransactionSummary;
  onPress?: () => void;
}

/** History row for trades + movements (docs/crypto/screens.md → orders / transactions). */
export function CryptoTransactionRow({ tx, onPress }: CryptoTransactionRowProps) {
  // "In" = crypto/cash arriving (sell proceeds, deposit); "out" = buy spend, withdraw.
  const isIn = tx.side === 'sell' || tx.side === 'deposit';
  const Icon = (tx.side === 'buy' || tx.side === 'deposit') ? ArrowDownLeft : ArrowUpRight;
  const sign = isIn ? '+' : '−';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${SIDE_LABEL[tx.side]} ${tx.symbol}, ${formatFiatObj(tx.fiat)}, ${tx.status}`}
      style={({ pressed }) => [cryptoTransactionRowStyles.row, pressed && cryptoTransactionRowStyles.pressed]}
    >
      <View style={[cryptoTransactionRowStyles.iconBox, { backgroundColor: `${tx.iconColor}1F` }]}>
        <Icon size={18} color={tx.iconColor} strokeWidth={2} />
      </View>

      <View style={cryptoTransactionRowStyles.mid}>
        <Text style={cryptoTransactionRowStyles.title} numberOfLines={1}>{SIDE_LABEL[tx.side]} {tx.symbol}</Text>
        <Text style={cryptoTransactionRowStyles.sub} numberOfLines={1}>{relativeTime(tx.createdAt)} · {tx.reference}</Text>
      </View>

      <View style={cryptoTransactionRowStyles.right}>
        <Text style={cryptoTransactionRowStyles.amount} numberOfLines={1}>{sign}{formatFiatObj(tx.fiat)}</Text>
        <CryptoStatusBadge status={tx.status} size="sm" />
      </View>
    </Pressable>
  );
}

const cryptoTransactionRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  pressed: { opacity: 0.7 },
  iconBox: { width: 42, height: 42, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  right: { alignItems: 'flex-end', gap: 4 },
  amount: { ...Typography.labelLg, color: Colors.onSurface },
});

interface HoldingRowProps {
  position: Position;
  onPress?: () => void;
}

/** Portfolio holding row: glyph · name/qty · market value · unrealized P/L %. */
export function HoldingRow({ position, onPress }: HoldingRowProps) {
  // Asset decimals drive crypto formatting; fall back to a sensible default.
  const { data: assets } = useAssets();
  const decimals = assets?.find((a) => a.id === position.assetId)?.decimals ?? 8;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${position.name} holding, ${formatFiatObj(position.marketValue)}`}
      style={({ pressed }) => [holdingRowStyles.row, pressed && holdingRowStyles.pressed]}
    >
      <AssetIcon symbol={position.symbol} color={position.iconColor} />
      <View style={holdingRowStyles.mid}>
        <Text style={holdingRowStyles.name} numberOfLines={1}>{position.name}</Text>
        <Text style={holdingRowStyles.qty} numberOfLines={1}>
          {formatCrypto(position.quantity.amount, position.symbol, decimals)}
        </Text>
      </View>
      <View style={holdingRowStyles.right}>
        <Text style={holdingRowStyles.value} numberOfLines={1}>{formatFiatObj(position.marketValue)}</Text>
        <PriceChange pct={position.unrealizedPct} />
      </View>
    </Pressable>
  );
}

const holdingRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  pressed: { opacity: 0.7 },
  mid: { flex: 1 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  qty: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  right: { alignItems: 'flex-end', gap: 3 },
  value: { ...Typography.labelLg, color: Colors.onSurface },
});

interface PriceChangeProps {
  pct: number;
  showIcon?: boolean;
  textStyle?: TextStyle;
}

/** Signed 24h change — teal when up, error-red when down (semantic tokens). */
export function PriceChange({ pct, showIcon = false, textStyle }: PriceChangeProps) {
  const up = pct >= 0;
  const color = up ? Colors.teal : Colors.error;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <View style={priceChangeStyles.row}>
      {showIcon ? <Icon size={14} color={color} strokeWidth={2.2} /> : null}
      <Text style={[priceChangeStyles.text, { color }, textStyle]}>{formatPct(pct)}</Text>
    </View>
  );
}

const priceChangeStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  text: { ...Typography.labelMd },
});

interface QuoteCountdownProps {
  expiresAt: string;
  onExpire?: () => void;
}

/**
 * Quote-expiry countdown pill (docs/crypto/modules.md → "expiry timer"). Ticks
 * once a second and fires onExpire when the locked quote elapses, driving the
 * re-quote path. Mirrors the fx RateLockCountdown.
 */
export function QuoteCountdown({ expiresAt, onExpire }: QuoteCountdownProps) {
  const [seconds, setSeconds] = useState(() => secondsUntil(expiresAt));

  useEffect(() => {
    setSeconds(secondsUntil(expiresAt));
    const id = setInterval(() => {
      const left = secondsUntil(expiresAt);
      setSeconds(left);
      if (left <= 0) {
        clearInterval(id);
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);

  const expired = seconds <= 0;
  const low = seconds <= 10;
  const pct = Math.max(0, Math.min(1, seconds / QUOTE_EXPIRY_SECONDS));
  const tint = expired || low ? Colors.error : Colors.teal;

  return (
    <View style={[quoteCountdownStyles.wrap, { backgroundColor: expired ? Colors.errorContainer : Colors.iconBgTeal }]}>
      <View style={quoteCountdownStyles.row}>
        {expired
          ? <TimerReset size={15} color={Colors.error} strokeWidth={2} />
          : <Lock size={15} color={tint} strokeWidth={2} />}
        <Text style={[quoteCountdownStyles.label, { color: tint }]}>
          {expired ? 'Quote expired — refresh to continue' : `Price locked · ${formatCountdown(seconds)}`}
        </Text>
      </View>
      {!expired ? (
        <View style={quoteCountdownStyles.track}>
          <View style={[quoteCountdownStyles.fill, { width: `${pct * 100}%`, backgroundColor: tint }]} />
        </View>
      ) : null}
    </View>
  );
}

const quoteCountdownStyles = StyleSheet.create({
  wrap: { borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { ...Typography.labelMd },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.06)', overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
});

interface RiskBadgeProps {
  rating: RiskRating;
  size?: 'sm' | 'md';
}

/** Pill-shaped risk-rating chip (DESIGN-Mobile.md → Chips & Badges). */
export function RiskBadge({ rating, size = 'md' }: RiskBadgeProps) {
  const style = RISK_STYLE[rating];
  return (
    <View style={[riskBadgeStyles.pill, size === 'sm' && riskBadgeStyles.pillSm, { backgroundColor: style.bg }]}>
      <Text style={[riskBadgeStyles.label, size === 'sm' && riskBadgeStyles.labelSm, { color: style.fg }]}>{style.label}</Text>
    </View>
  );
}

const riskBadgeStyles = StyleSheet.create({
  pill: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  pillSm: { paddingVertical: 3, paddingHorizontal: 7 },
  label: { ...Typography.labelSm, fontWeight: '600' as const },
  labelSm: { ...Typography.caption, fontWeight: '600' as const },
});

interface VolatilityWarningProps {
  message?: string;
  compact?: boolean;
}

/**
 * Risk-education card shown before/around every crypto trade (education-first;
 * docs/crypto/product.md). Uses the gold/warning tint so it reads as caution,
 * not error.
 */
export function VolatilityWarning({ message = VOLATILITY_DISCLOSURE, compact }: VolatilityWarningProps) {
  return (
    <View style={[volatilityWarningStyles.card, compact && volatilityWarningStyles.compact]}>
      <View style={volatilityWarningStyles.iconBox}>
        <TriangleAlert size={16} color={Colors.onWarning} strokeWidth={2} />
      </View>
      <Text style={volatilityWarningStyles.text}>{message}</Text>
    </View>
  );
}

const volatilityWarningStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.iconBgGold,
    padding: Spacing.md,
  },
  compact: { padding: Spacing.sm },
  iconBox: { marginTop: 1 },
  text: { ...Typography.labelSm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
});
