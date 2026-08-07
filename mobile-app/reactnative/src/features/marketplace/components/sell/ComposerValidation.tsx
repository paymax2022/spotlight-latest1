// ── Sell — Smart Composer live validation (screen 11) ────────────────────────
// Real-time, client-side validation surfaced inline (never on-submit-only):
//   • word-count progress toward the category minimum,
//   • photo-count checklist toward the category minimum,
//   • banned-pattern check (contact-info / off-platform / scam language),
//   • duplicate-photo warning.
// This is the deliberate fix versus async-only moderation: the seller sees the
// problem before they move on. The server re-validates as the authoritative gate.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { AlertTriangle, CheckCircle2, Circle } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { MarketColors } from '@/features/marketplace';

export interface ComposerValidationState {
  wordCount: number;
  minWords: number;
  photoCount: number;
  minPhotos: number;
  hasDuplicatePhoto: boolean;
  bannedMatches: string[];
}

// Banned-pattern table — flags the two things that get listings rejected: sharing
// contact info / pushing off-platform, and obvious scam language. Client-side
// heuristic only; the server holds the authoritative content-policy gate.
const BANNED_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b\d[\d\s-]{8,}\d\b/, label: 'phone number' },
  { re: /whats\s?app|wa\.me|telegram|\bdm\b/i, label: 'off-platform contact' },
  { re: /gift\s?card|western\s?union|bitcoin|crypto\s?only/i, label: 'suspicious payment method' },
  { re: /pay\s?(me\s?)?(direct|outside|cash\s?only\s?no\s?escrow)/i, label: 'pay-outside-escrow' },
];

export function checkBannedPatterns(text: string): string[] {
  return BANNED_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
}

export function countWords(text: string): number {
  const t = text.trim();
  return t.length === 0 ? 0 : t.split(/\s+/).length;
}

function Ring({ value, max }: { value: number; max: number }) {
  const pct = Math.min(1, max > 0 ? value / max : 0);
  const complete = value >= max;
  return (
    <View style={[styles.ring, complete && styles.ringComplete]}>
      <View style={[styles.ringFill, { height: `${pct * 100}%`, backgroundColor: complete ? MarketColors.ok : MarketColors.brand }]} />
    </View>
  );
}

export default function ComposerValidation({ state }: { state: ComposerValidationState }) {
  const wordsOk = state.wordCount >= state.minWords;
  const photosOk = state.photoCount >= state.minPhotos;
  const bannedOk = state.bannedMatches.length === 0;
  const allOk = wordsOk && photosOk && bannedOk && !state.hasDuplicatePhoto;

  const wordsLeft = state.minWords - state.wordCount;
  const photosLeft = state.minPhotos - state.photoCount;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Ring value={state.wordCount} max={state.minWords} />
        <View style={styles.rowBody}>
          <Text style={[styles.label, !wordsOk && styles.labelWarn]}>{state.wordCount}/{state.minWords} words minimum</Text>
          {!wordsOk ? (
            <Text style={styles.errorText}>Add {wordsLeft} more word{wordsLeft === 1 ? '' : 's'} so buyers know what they're getting.</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.row}>
        {photosOk ? <CheckCircle2 size={18} color={MarketColors.ok} /> : <Circle size={18} color={MarketColors.muted} />}
        <View style={styles.rowBody}>
          <Text style={[styles.label, !photosOk && styles.labelWarn]}>{state.photoCount}/{state.minPhotos} photos for this category</Text>
          {!photosOk ? <Text style={styles.errorText}>Add {photosLeft} more photo{photosLeft === 1 ? '' : 's'}.</Text> : null}
        </View>
      </View>

      {!bannedOk ? (
        <View style={styles.warnBanner}>
          <AlertTriangle size={16} color={MarketColors.warnText} />
          <Text style={styles.warnText}>
            Remove {state.bannedMatches.join(', ')} from your description. Keep deals inside Paymax escrow — it's what protects you if a buyer disputes.
          </Text>
        </View>
      ) : null}

      {state.hasDuplicatePhoto ? (
        <View style={styles.warnBanner}>
          <AlertTriangle size={16} color={MarketColors.warnText} />
          <Text style={styles.warnText}>One photo looks like a duplicate. Duplicate/stolen photos get listings rejected — please use your own photos.</Text>
        </View>
      ) : null}

      {allOk ? (
        <View style={styles.okBanner}>
          <CheckCircle2 size={16} color={MarketColors.ok} />
          <Text style={styles.okText}>Looks good — ready to continue.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm, paddingTop: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowBody: { flex: 1 },
  label: { ...Typography.labelMd, color: MarketColors.text },
  labelWarn: { color: MarketColors.warnText },
  errorText: { ...Typography.labelSm, color: MarketColors.danger, marginTop: 2 },
  ring: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: MarketColors.border, overflow: 'hidden', justifyContent: 'flex-end' },
  ringComplete: { borderColor: MarketColors.ok },
  ringFill: { width: '100%' },
  warnBanner: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: MarketColors.warnBg, borderRadius: Radius.md, padding: Spacing.sm },
  warnText: { ...Typography.labelSm, color: MarketColors.warnText, flex: 1 },
  okBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: MarketColors.okBg, borderRadius: Radius.md, padding: Spacing.sm },
  okText: { ...Typography.labelSm, color: MarketColors.ok, fontWeight: '600' },
});
