import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BadgeCheck, ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow3 } from '@/constants/shadows';
import QrCodeView from '@/components/QrCodeView';
import { formatDate, initials } from '../utils/associationFormatters';
import { MEMBER_STATUS_STYLE, PAYMENT_STANDING_STYLE } from '../constants/association.constants';
import type { MembershipCard } from '../types/association.types';

interface Props {
  card: MembershipCard;
  showQr?: boolean;
}

/**
 * Digital membership ID card — the showpiece "glass on gradient" surface
 * (DESIGN-Mobile.md → Elevation L2/L3). Reuses the shared QrCodeView primitive.
 */
export default function MembershipCardView({ card, showQr = true }: Props) {
  const dimmed = card.status === 'SUSPENDED' || card.status === 'EXPIRED';
  const statusStyle = MEMBER_STATUS_STYLE[card.status];
  const payStyle = PAYMENT_STANDING_STYLE[card.paymentStanding];

  return (
    <LinearGradient
      colors={(dimmed ? Colors.gradientMuted : Colors.gradientPurple) as [string, string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, shadow3]}
    >
      {/* Header: org + verification */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.org} numberOfLines={1}>
            {card.organisationAcronym ?? card.organisationName}
          </Text>
          <Text style={styles.orgSub} numberOfLines={1}>{card.organisationName}</Text>
        </View>
        {card.verified ? (
          <View style={styles.verifyPill}>
            <BadgeCheck size={13} color={Colors.tertiaryFixed} strokeWidth={2.4} />
            <Text style={styles.verifyText}>Verified</Text>
          </View>
        ) : null}
      </View>

      {/* Identity */}
      <View style={styles.idRow}>
        <View style={styles.photo}>
          {card.photoUrl ? (
            <Image source={{ uri: card.photoUrl }} style={styles.photoImg} />
          ) : (
            <Text style={styles.photoText}>{initials(card.fullName)}</Text>
          )}
        </View>
        <View style={styles.idBody}>
          <Text style={styles.name} numberOfLines={1}>{card.fullName}</Text>
          <Text style={styles.memberId}>{card.memberId}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {card.categoryLabel}{card.chapterName ? ` · ${card.chapterName}` : ''}
          </Text>
        </View>
      </View>

      {/* Status row */}
      <View style={styles.statusRow}>
        <View style={[styles.chip, { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
          <View style={[styles.chipDot, { backgroundColor: statusStyle.color }]} />
          <Text style={styles.chipText}>{statusStyle.label}</Text>
        </View>
        <View style={[styles.chip, { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
          <View style={[styles.chipDot, { backgroundColor: payStyle.color }]} />
          <Text style={styles.chipText}>{payStyle.label}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Text style={styles.valid}>Valid thru {formatDate(card.validThrough)}</Text>
      </View>

      {/* QR */}
      {showQr ? (
        <View style={styles.qrWrap}>
          <QrCodeView payload={card.qrPayload} size={148} />
          <Text style={styles.qrHint}>Show this code for verification</Text>
        </View>
      ) : null}

      {dimmed ? (
        <View style={styles.dimNotice}>
          <ShieldAlert size={14} color={Colors.errorContainer} strokeWidth={2} />
          <Text style={styles.dimText}>
            This card is {statusStyle.label.toLowerCase()} and cannot be used for verification.
          </Text>
        </View>
      ) : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  org: { ...Typography.titleLg, color: Colors.white, fontWeight: '800' as const },
  orgSub: { ...Typography.labelSm, color: 'rgba(255,255,255,0.7)' },
  verifyPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(72,184,172,0.22)',
    borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  verifyText: { ...Typography.caption, color: Colors.tertiaryFixed, fontWeight: '700' as const },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  photo: {
    width: 64, height: 64, borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  photoImg: { width: '100%', height: '100%' },
  photoText: { ...Typography.headlineMd, color: Colors.white },
  idBody: { flex: 1, gap: 2 },
  name: { ...Typography.titleMd, color: Colors.white },
  memberId: { ...Typography.labelMd, color: Colors.inversePrimary, letterSpacing: 0.5 },
  meta: { ...Typography.labelSm, color: 'rgba(255,255,255,0.7)' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  chipDot: { width: 6, height: 6, borderRadius: Radius.full },
  chipText: { ...Typography.caption, color: Colors.white, fontWeight: '600' as const },
  valid: { ...Typography.caption, color: 'rgba(255,255,255,0.7)' },
  qrWrap: { alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  qrHint: { ...Typography.labelSm, color: 'rgba(255,255,255,0.7)' },
  dimNotice: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: 'rgba(186,26,26,0.25)',
    borderRadius: Radius.md, padding: Spacing.sm,
  },
  dimText: { ...Typography.labelSm, color: Colors.errorContainer, flex: 1 },
});
