// ── Insurance (live) — a policy the user actually holds ─────────────────────
// Rendered from GET /policies. Everything on it is real: the insurer's own
// policy reference, the premium paid, the cover it buys, and when it runs out.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, FileCheck2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { InsuranceColors } from '../../constants/insurance.constants';
import { nairaCompact, nairaFromKobo } from '../../live/money';
import type { Policy } from '../../live/types';
import StatusPill from './StatusPill';
import UnderwriterMark from './UnderwriterMark';

/** "12 days left", "Expired 3 days ago", or null when there is no end date. */
export function expiryNote(endsAt: string | null): string | null {
  if (!endsAt) return null;
  const t = Date.parse(endsAt);
  if (!Number.isFinite(t)) return null;
  const days = Math.round((t - Date.now()) / 86_400_000);
  if (days < 0) return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  if (days <= 30) return `${days} days left`;
  return `Renews ${new Date(t).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export default function LivePolicyCard({
  policy,
  onPress,
}: {
  policy: Policy;
  onPress: () => void;
}) {
  const note = expiryNote(policy.endsAt);
  const urgent =
    policy.status === 'active' && !!note && /left|today|tomorrow/.test(note);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${policy.productName}, ${policy.status}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.topRow}>
        <UnderwriterMark
          underwriter={policy.underwriter}
          size={36}
        />
        <View style={styles.grow}>
          <Text style={styles.title} numberOfLines={2}>
            {policy.productName}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {policy.underwriter || 'Underwriter pending'}
          </Text>
        </View>
        <ChevronRight size={20} color={Colors.onSurfaceVariant} />
      </View>

      <View style={styles.divider} />

      <View style={styles.factRow}>
        <Fact label="Cover" value={policy.sumInsuredKobo > 0 ? nairaCompact(policy.sumInsuredKobo) : '—'} />
        <Fact label="Premium" value={nairaFromKobo(policy.premiumKobo)} />
        <Fact label="Reference" value={policy.policyRef ? shortRef(policy.policyRef) : '—'} />
      </View>

      <View style={styles.footRow}>
        <StatusPill status={policy.status} />
        {note ? (
          <Text style={[styles.note, urgent && styles.noteUrgent]} numberOfLines={1}>
            {note}
          </Text>
        ) : null}
        <View style={styles.grow} />
        {policy.certificateUrl ? (
          <View style={styles.certChip}>
            <FileCheck2 size={13} color={InsuranceColors.ok} />
            <Text style={styles.certText}>Certificate</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function shortRef(ref: string): string {
  return ref.length <= 12 ? ref : `${ref.slice(0, 4)}…${ref.slice(-6)}`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  pressed: { opacity: 0.9 },
  grow: { flex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  divider: { height: 1, backgroundColor: InsuranceColors.border },
  factRow: { flexDirection: 'row', gap: Spacing.md },
  fact: { flex: 1 },
  factLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  factValue: { ...Typography.labelLg, color: Colors.onSurface, marginTop: 2 },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  noteUrgent: { color: InsuranceColors.warnText, fontWeight: '600' as const },
  certChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  certText: { ...Typography.labelSm, color: InsuranceColors.ok },
});
