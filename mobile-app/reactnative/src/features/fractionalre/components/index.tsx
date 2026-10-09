import { KIND_COLOR, KIND_LABEL, PAYOUT_FREQ_LABEL, RISK_BAND_COLOR, RISK_BAND_LABEL, RISK_DISCLOSURE_RIBBON } from '../constants';
import type { AllocationSlice, CapTableSlice, Certificate, MarketListing, OfferingDetail, OfferingSummary, RiskBand } from '../types';
import { calcReturns, countdownLabel, formatNaira, formatNairaCompact, formatYield, msUntil, progressPct, relativeDate, tenorLabel } from '../utils';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { sanitizeMoneyInput } from '@/utils/money';
import { router } from 'expo-router';
import { BadgeCheck, Check, ChevronRight, Clock, Heart, Info, MapPin, ScrollText, ShieldAlert, ShieldCheck } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';


interface AllocationDonutProps {
  slices: AllocationSlice[];
  size?: number;
  centerLabel?: string;
  centerValue?: string;
}

/** Portfolio allocation donut (react-native-svg) + legend with kobo values. */
export function AllocationDonut({ slices, size = 160, centerLabel, centerValue }: AllocationDonutProps) {
  const data = slices.filter((s) => s.pct > 0);
  const stroke = 18;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  return (
    <View style={allocationDonutStyles.wrap}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <G rotation={-90} origin={`${cx}, ${cy}`}>
            <Circle cx={cx} cy={cy} r={r} stroke={Colors.surfaceContainerHigh} strokeWidth={stroke} fill="none" />
            {data.map((s) => {
              const len = (s.pct / 100) * circ;
              const seg = (
                <Circle
                  key={s.kind}
                  cx={cx} cy={cy} r={r}
                  stroke={KIND_COLOR[s.kind]} strokeWidth={stroke} fill="none"
                  strokeDasharray={`${len} ${circ - len}`}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                />
              );
              offset += len;
              return seg;
            })}
          </G>
        </Svg>
        {(centerLabel || centerValue) ? (
          <View style={allocationDonutStyles.center} pointerEvents="none">
            {centerValue ? <Text style={allocationDonutStyles.centerValue}>{centerValue}</Text> : null}
            {centerLabel ? <Text style={allocationDonutStyles.centerLabel}>{centerLabel}</Text> : null}
          </View>
        ) : null}
      </View>

      <View style={allocationDonutStyles.legend}>
        {data.map((s) => (
          <View key={s.kind} style={allocationDonutStyles.legendRow}>
            <View style={[allocationDonutStyles.dot, { backgroundColor: KIND_COLOR[s.kind] }]} />
            <Text style={allocationDonutStyles.legendLabel}>{s.label}</Text>
            <Text style={allocationDonutStyles.legendVal}>{s.pct}% · {formatNairaCompact(s.valueKobo)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const allocationDonutStyles = StyleSheet.create({
  wrap: { gap: Spacing.md, alignItems: 'center' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  centerValue: { ...Typography.titleMd, color: Colors.onSurface },
  centerLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  legend: { gap: 8, alignSelf: 'stretch' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  legendVal: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});

const PALETTE = [Colors.primary, Colors.secondary, Colors.teal, Colors.gold, Colors.error];

/** Compact stacked cap-table bar + legend. */
export function CapTableMini({ slices }: { slices: CapTableSlice[] }) {
  return (
    <View style={capTableMiniStyles.wrap}>
      <View style={capTableMiniStyles.bar}>
        {slices.map((s, i) => (
          <View key={s.label} style={{ width: `${s.pct}%`, backgroundColor: PALETTE[i % PALETTE.length] }} />
        ))}
      </View>
      <View style={capTableMiniStyles.legend}>
        {slices.map((s, i) => (
          <View key={s.label} style={capTableMiniStyles.legendRow}>
            <View style={[capTableMiniStyles.dot, { backgroundColor: PALETTE[i % PALETTE.length] }]} />
            <Text style={capTableMiniStyles.legendLabel}>{s.label}</Text>
            <Text style={capTableMiniStyles.legendPct}>{s.pct}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const capTableMiniStyles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  bar: { flexDirection: 'row', height: 14, borderRadius: Radius.full, overflow: 'hidden', backgroundColor: Colors.surfaceContainerHigh },
  legend: { gap: 6 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  legendPct: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
});

/** Read-only ownership certificate card (subscription confirmation §8.D.8). */
export function CertificateView({ certificate }: { certificate: Certificate }) {
  return (
    <View style={certificateViewStyles.cert}>
      <View style={certificateViewStyles.header}>
        <ScrollText size={22} color={Colors.primary} strokeWidth={2} />
        <Text style={certificateViewStyles.headerText}>Certificate of Fractional Ownership</Text>
      </View>

      <View style={certificateViewStyles.divider} />

      <Row label="Certificate no." value={certificate.certificateNo} mono />
      <Row label="Offering" value={certificate.offeringTitle} />
      <Row label="SPV" value={certificate.spvName} />
      <Row label="Units held" value={String(certificate.units)} />
      <Row label="Amount invested" value={formatNaira(certificate.amountKobo)} accent />
      <Row label="Issued" value={relativeDate(certificate.issuedAt)} />

      <View style={certificateViewStyles.footerRow}>
        <BadgeCheck size={14} color={Colors.teal} strokeWidth={2} />
        <Text style={certificateViewStyles.footerText}>Recorded on the SPV register. Your interest is held in {certificate.spvName}.</Text>
      </View>
    </View>
  );
}

function Row({ label, value, accent, mono }: { label: string; value: string; accent?: boolean; mono?: boolean }) {
  return (
    <View style={certificateViewStyles.row}>
      <Text style={certificateViewStyles.rowLabel}>{label}</Text>
      <Text style={[certificateViewStyles.rowVal, accent && certificateViewStyles.accent, mono && certificateViewStyles.mono]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const certificateViewStyles = StyleSheet.create({
  cert: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1.5, borderColor: Colors.primaryContainer, gap: Spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerText: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.md },
  rowLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowVal: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  accent: { color: Colors.primary },
  mono: { letterSpacing: 0.5 },
  footerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: Spacing.sm },
  footerText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 16 },
});

interface FundingProgressBarProps {
  raisedKobo: number;
  targetKobo: number;
  showLabels?: boolean;
}

export function FundingProgressBar({ raisedKobo, targetKobo, showLabels = true }: FundingProgressBarProps) {
  const pct = progressPct(raisedKobo, targetKobo);
  return (
    <View>
      <View style={fundingProgressBarStyles.track}>
        <View style={[fundingProgressBarStyles.fill, { width: `${pct}%` }]} />
      </View>
      {showLabels ? (
        <View style={fundingProgressBarStyles.row}>
          <Text style={fundingProgressBarStyles.raised}>{formatNairaCompact(raisedKobo)} raised</Text>
          <Text style={fundingProgressBarStyles.pct}>{pct}% of {formatNairaCompact(targetKobo)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const fundingProgressBarStyles = StyleSheet.create({
  track: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.tertiaryContainer === '#00453F' ? '#16A34A' : Colors.teal },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  raised: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '600' },
  pct: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});

interface MarketListingRowProps {
  listing: MarketListing;
  onPress?: () => void;
}

/** Secondary-market listing row with NAV-anchored price + premium/discount tag. */
export function MarketListingRow({ listing, onPress }: MarketListingRowProps) {
  const deltaBps = listing.navPerUnitKobo > 0
    ? Math.round(((listing.pricePerUnitKobo - listing.navPerUnitKobo) / listing.navPerUnitKobo) * 10_000)
    : 0;
  const premium = deltaBps > 0;
  const deltaLabel = `${premium ? '+' : ''}${(deltaBps / 100).toFixed(1)}% vs NAV`;
  const deltaColor = premium ? Colors.onWarning : Colors.teal;

  return (
    <Pressable style={marketListingRowStyles.row} onPress={onPress} disabled={!onPress}>
      <View style={marketListingRowStyles.left}>
        <Text style={marketListingRowStyles.title} numberOfLines={1}>{listing.offeringTitle}</Text>
        <Text style={marketListingRowStyles.sub}>{KIND_LABEL[listing.kind]} · {listing.units} units · {listing.sellerMasked}</Text>
        <Text style={marketListingRowStyles.listed}>Listed {relativeDate(listing.listedAt)}</Text>
      </View>
      <View style={marketListingRowStyles.right}>
        <Text style={marketListingRowStyles.price}>{formatNaira(listing.pricePerUnitKobo)}</Text>
        <Text style={marketListingRowStyles.perUnit}>per unit</Text>
        <Text style={[marketListingRowStyles.delta, { color: deltaColor }]}>{deltaLabel}</Text>
      </View>
      {onPress ? <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} /> : null}
    </Pressable>
  );
}

const marketListingRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  left: { flex: 1, gap: 2 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  listed: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  right: { alignItems: 'flex-end' },
  price: { ...Typography.labelLg, color: Colors.onSurface },
  perUnit: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  delta: { ...Typography.labelSm, fontWeight: '600', marginTop: 2 },
});

/** Live countdown chip for a funding window. Ticks once a minute. */
export function OfferCountdown({ closesAt, inline }: { closesAt: string | null; inline?: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!closesAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [closesAt]);

  if (!closesAt) return null;
  const ms = msUntil(closesAt);
  const closed = ms !== null && ms <= 0;
  const urgent = ms !== null && ms > 0 && ms < 3 * 86_400_000;
  const color = closed ? Colors.onSurfaceVariant : urgent ? Colors.onWarning : Colors.secondary;

  if (inline) {
    return <Text style={[offerCountdownStyles.inline, { color }]}>{closed ? 'Closed' : `Closes in ${countdownLabel(closesAt)}`}</Text>;
  }
  return (
    <View style={[offerCountdownStyles.chip, { backgroundColor: color + '14' }]}>
      <Clock size={13} color={color} strokeWidth={2} />
      <Text style={[offerCountdownStyles.label, { color }]}>{closed ? 'Closed' : countdownLabel(closesAt)}</Text>
    </View>
  );
}

const offerCountdownStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: Radius.full, alignSelf: 'flex-start',
  },
  label: { ...Typography.labelSm, fontWeight: '600' },
  inline: { ...Typography.labelSm, fontWeight: '600' },
});

interface OpportunityCardProps {
  offering: OfferingSummary;
  onToggleWatch?: (o: OfferingSummary) => void;
}

export function OpportunityCard({ offering, onToggleWatch }: OpportunityCardProps) {
  return (
    <Pressable style={opportunityCardStyles.card} onPress={() => router.push(`/fractionalre/${offering.id}` as never)}>
      <View>
        <Image source={{ uri: offering.coverImageUrl }} style={opportunityCardStyles.image} />
        <View style={opportunityCardStyles.imageOverlay}>
          <View style={opportunityCardStyles.kindChip}><Text style={opportunityCardStyles.kindText}>{KIND_LABEL[offering.kind]}</Text></View>
          {onToggleWatch ? (
            <Pressable
              hitSlop={8}
              onPress={(e) => { e.stopPropagation?.(); onToggleWatch(offering); }}
              style={opportunityCardStyles.heartBtn}
              accessibilityLabel={offering.watched ? 'Remove from watchlist' : 'Add to watchlist'}
            >
              <Heart size={18} color={offering.watched ? Colors.error : Colors.onPrimary}
                fill={offering.watched ? Colors.error : 'transparent'} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={opportunityCardStyles.body}>
        <Text style={opportunityCardStyles.title} numberOfLines={1}>{offering.title}</Text>
        <View style={opportunityCardStyles.locRow}>
          <MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={opportunityCardStyles.loc} numberOfLines={1}>{offering.location}</Text>
        </View>

        <View style={opportunityCardStyles.metrics}>
          <View style={opportunityCardStyles.metric}>
            <Text style={opportunityCardStyles.metricVal}>{formatYield(offering.projectedYieldBps)}</Text>
            <Text style={opportunityCardStyles.metricLabel}>Proj. yield</Text>
          </View>
          <View style={opportunityCardStyles.metric}>
            <Text style={opportunityCardStyles.metricVal}>{tenorLabel(offering.tenorMonths)}</Text>
            <Text style={opportunityCardStyles.metricLabel}>Tenor</Text>
          </View>
          <View style={opportunityCardStyles.metric}>
            <Text style={opportunityCardStyles.metricVal}>{formatNaira(offering.unitPriceKobo)}</Text>
            <Text style={opportunityCardStyles.metricLabel}>Per unit</Text>
          </View>
        </View>

        <FundingProgressBar raisedKobo={offering.raisedKobo} targetKobo={offering.targetKobo} />

        <View style={opportunityCardStyles.footer}>
          <View style={opportunityCardStyles.badges}>
            <RiskBandPill band={offering.riskBand} small />
            <TitleVerifiedBadge verified={offering.titleVerified} small />
          </View>
          <OfferCountdown closesAt={offering.closesAt} />
        </View>
      </View>
    </Pressable>
  );
}

const opportunityCardStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  image: { width: '100%', height: 150, backgroundColor: Colors.surfaceContainerHigh },
  imageOverlay: {
    position: 'absolute', top: Spacing.sm, left: Spacing.sm, right: Spacing.sm,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  kindChip: { backgroundColor: 'rgba(11,28,48,0.7)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  kindText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '600' },
  heartBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(11,28,48,0.5)', alignItems: 'center', justifyContent: 'center' },
  body: { padding: Spacing.md, gap: Spacing.sm },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  loc: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  metrics: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 2 },
  metric: { alignItems: 'flex-start' },
  metricVal: { ...Typography.labelLg, color: Colors.onSurface },
  metricLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1 },
});

interface ReturnsCalculatorProps {
  offering: OfferingSummary | OfferingDetail;
  /** Optional fixed amount (kobo); when omitted the user types one. */
  initialAmountKobo?: number;
  editable?: boolean;
}

/** Returns preview. CLIENT ESTIMATE only — backend confirms actual payouts. */
export function ReturnsCalculator({ offering, initialAmountKobo, editable = true }: ReturnsCalculatorProps) {
  const [naira, setNaira] = useState(String((initialAmountKobo ?? offering.unitPriceKobo * (offering.minUnits || 1)) / 100));
  const amountKobo = Math.max(0, Math.round((parseFloat(naira) || 0) * 100));

  const result = useMemo(() => calcReturns({
    amountKobo,
    projectedYieldBps: offering.projectedYieldBps,
    tenorMonths: offering.tenorMonths,
    payoutFrequency: offering.payoutFrequency,
  }), [amountKobo, offering]);

  return (
    <View style={returnsCalculatorStyles.wrap}>
      {editable ? (
        <View style={returnsCalculatorStyles.inputBlock}>
          <Text style={returnsCalculatorStyles.inputLabel}>Investment amount</Text>
          <View style={returnsCalculatorStyles.inputRow}>
            <Text style={returnsCalculatorStyles.currency}>₦</Text>
            <TextInput
              value={naira}
              onChangeText={(t) => setNaira(sanitizeMoneyInput(t))}
              keyboardType="decimal-pad"
              maxLength={13}
              style={returnsCalculatorStyles.input}
              placeholder="0"
              placeholderTextColor={Colors.onSurfaceVariant}
            />
          </View>
        </View>
      ) : null}

      <View style={returnsCalculatorStyles.rows}>
        <ReturnsRow label="Projected yield" value={`${formatYield(offering.projectedYieldBps)} p.a.`} />
        <ReturnsRow label={`Payout (${PAYOUT_FREQ_LABEL[offering.payoutFrequency].toLowerCase()})`}
          value={formatNaira(result.periodicPayoutKobo)} />
        <ReturnsRow label="Total projected income" value={formatNaira(result.totalIncomeKobo)} accent />
        <ReturnsRow label="Projected value at exit" value={formatNaira(result.projectedExitKobo)} accent />
      </View>

      <Text style={returnsCalculatorStyles.disclaimer}>
        Estimate only. Projected returns are not guaranteed and your capital is at risk.
      </Text>
    </View>
  );
}

function ReturnsRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={returnsCalculatorStyles.row}>
      <Text style={returnsCalculatorStyles.rowLabel}>{label}</Text>
      <Text style={[returnsCalculatorStyles.rowVal, accent && returnsCalculatorStyles.rowValAccent]}>{value}</Text>
    </View>
  );
}

const returnsCalculatorStyles = StyleSheet.create({
  wrap: { gap: Spacing.md },
  inputBlock: { gap: 6 },
  inputLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  currency: { ...Typography.titleLg, color: Colors.onSurface, marginRight: 4 },
  input: { ...Typography.titleLg, color: Colors.onSurface, flex: 1, paddingVertical: Spacing.md },
  rows: { gap: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowVal: { ...Typography.labelLg, color: Colors.onSurface },
  rowValAccent: { color: Colors.primary },
  disclaimer: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 16 },
});

interface RiskAckSheetProps {
  title?: string;
  body: string;            // long disclosure text (paragraphs separated by \n\n)
  confirmLabel?: string;
  /** Optional checkbox confirmation copy; when set, both scroll + check are required. */
  checkLabel?: string;
  onAccept: () => void;
  accepting?: boolean;
}

/**
 * Scroll-gated risk acknowledgement. The accept button stays disabled until the
 * user scrolls to the bottom of the disclosure (and ticks the box if provided).
 * Used for the master disclosure (activation) and per-offer e-sign step.
 */
export function RiskAckSheet({ title, body, confirmLabel = 'I have read and understand', checkLabel, onAccept, accepting }: RiskAckSheetProps) {
  const [scrolledEnd, setScrolledEnd] = useState(false);
  const [checked, setChecked] = useState(false);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 24) setScrolledEnd(true);
  };

  const canAccept = scrolledEnd && (!checkLabel || checked);
  const paragraphs = body.split('\n\n');

  return (
    <View style={riskAckSheetStyles.wrap}>
      {title ? <Text style={riskAckSheetStyles.title}>{title}</Text> : null}
      <ScrollView
        style={riskAckSheetStyles.scroll}
        contentContainerStyle={riskAckSheetStyles.scrollContent}
        onScroll={onScroll}
        scrollEventThrottle={64}
        showsVerticalScrollIndicator
      >
        {paragraphs.map((p, i) => (
          <Text key={i} style={riskAckSheetStyles.para}>{p}</Text>
        ))}
        <Text style={riskAckSheetStyles.endMark}>— End of disclosure —</Text>
      </ScrollView>

      {!scrolledEnd ? (
        <Text style={riskAckSheetStyles.hint}>Scroll to the end to continue.</Text>
      ) : null}

      {checkLabel ? (
        <Pressable style={riskAckSheetStyles.checkRow} onPress={() => setChecked((c) => !c)} disabled={!scrolledEnd}>
          <View style={[riskAckSheetStyles.checkbox, checked && riskAckSheetStyles.checkboxOn, !scrolledEnd && riskAckSheetStyles.checkboxDim]}>
            {checked ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
          </View>
          <Text style={riskAckSheetStyles.checkLabel}>{checkLabel}</Text>
        </Pressable>
      ) : null}

      <PrimaryButton label={confirmLabel} onPress={onAccept} disabled={!canAccept} loading={accepting} />
    </View>
  );
}

const riskAckSheetStyles = StyleSheet.create({
  wrap: { gap: Spacing.md, flex: 1 },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  scroll: { flex: 1, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  scrollContent: { padding: Spacing.md, gap: Spacing.md },
  para: { ...Typography.bodySm, color: Colors.onSurface, lineHeight: 21 },
  endMark: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  checkbox: { width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkboxDim: { opacity: 0.4 },
  checkLabel: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
});

export function RiskBandPill({ band, small }: { band: RiskBand; small?: boolean }) {
  const color = RISK_BAND_COLOR[band];
  return (
    <View style={[riskBandPillStyles.pill, { backgroundColor: color + '1A' }, small && riskBandPillStyles.small]}>
      <View style={[riskBandPillStyles.dot, { backgroundColor: color }]} />
      <Text style={[riskBandPillStyles.label, { color }]}>{RISK_BAND_LABEL[band]}</Text>
    </View>
  );
}

const riskBandPillStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full, alignSelf: 'flex-start',
  },
  small: { paddingHorizontal: 8, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { ...Typography.labelSm, fontWeight: '600' },
});

/** Mandatory persistent SEC-style risk-disclosure ribbon. Surfaced on home,
 *  marketplace and subscription screens. */
export function RiskRibbon({ text, compact }: { text?: string; compact?: boolean }) {
  return (
    <View style={[riskRibbonStyles.ribbon, compact && riskRibbonStyles.compact]}>
      <Info size={14} color={Colors.onWarning} strokeWidth={2} />
      <Text style={riskRibbonStyles.text} numberOfLines={compact ? 2 : undefined}>
        {text ?? RISK_DISCLOSURE_RIBBON}
      </Text>
    </View>
  );
}

const riskRibbonStyles = StyleSheet.create({
  ribbon: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.iconBgGold, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderWidth: 1, borderColor: 'rgba(234,179,8,0.35)',
  },
  compact: { paddingVertical: 8 },
  text: { ...Typography.labelSm, color: Colors.onWarning, flex: 1, lineHeight: 16 },
});

export function TitleVerifiedBadge({ verified, small }: { verified: boolean; small?: boolean }) {
  const color = verified ? Colors.teal : Colors.onWarning;
  const Icon = verified ? ShieldCheck : ShieldAlert;
  return (
    <View style={[titleVerifiedBadgeStyles.badge, { backgroundColor: color + '1A' }, small && titleVerifiedBadgeStyles.small]}>
      <Icon size={small ? 12 : 14} color={color} strokeWidth={2} />
      <Text style={[titleVerifiedBadgeStyles.label, { color }]}>{verified ? 'Title verified' : 'Title pending'}</Text>
    </View>
  );
}

const titleVerifiedBadgeStyles = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full, alignSelf: 'flex-start',
  },
  small: { paddingHorizontal: 6, paddingVertical: 2 },
  label: { ...Typography.labelSm, fontWeight: '600' },
});
