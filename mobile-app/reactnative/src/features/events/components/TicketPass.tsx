import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Calendar, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import QrCodeView from '@/components/QrCodeView';
import { EventColors, TICKET_STATE_BADGE, eventCoverEmoji, eventBannerColor } from '../constants/events.constants';
import type { Ticket, EventDetail } from '../types';

function dt(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

interface Props {
  ticket: Ticket;
  /** Event context — the backend Ticket carries only ids, not display fields. */
  event?: EventDetail;
  tierName?: string;
  /** The rotating QR payload (changes every few seconds for anti-screenshot). */
  qrPayload?: string;
  showQr?: boolean;
}

export default function TicketPass({ ticket, event, tierName, qrPayload, showQr = true }: Props) {
  const meta = TICKET_STATE_BADGE[ticket.state] ?? TICKET_STATE_BADGE.ISSUED;
  const inactive = ticket.state !== 'ISSUED';
  const bannerColor = event ? eventBannerColor(event.id, event.category) : EventColors.brand;
  const coverEmoji = event ? eventCoverEmoji(event.category) : '🎟️';
  return (
    <View style={styles.wrap}>
      <View style={[styles.header, { backgroundColor: bannerColor }]}>
        <Text style={styles.emoji}>{coverEmoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={2}>{event?.title ?? 'Event'}</Text>
          <Text style={styles.tier}>{tierName ?? 'Ticket'}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: meta.bg }]}>
          <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {/* perforation */}
      <View style={styles.perf}>
        <View style={[styles.notch, styles.notchLeft]} />
        <View style={styles.dashRow}>
          {Array.from({ length: 22 }).map((_, i) => <View key={i} style={styles.dash} />)}
        </View>
        <View style={[styles.notch, styles.notchRight]} />
      </View>

      <View style={styles.body}>
        {showQr ? (
          <View style={[styles.qrWrap, inactive && styles.qrDim]}>
            <QrCodeView payload={qrPayload ?? ticket.credential_id} size={180} fill={bannerColor} />
            {inactive ? (
              <View style={styles.qrOverlay}><Text style={styles.qrOverlayText}>{meta.label}</Text></View>
            ) : (
              <Text style={styles.rotating}>Code refreshes automatically</Text>
            )}
          </View>
        ) : null}

        {event ? (
          <>
            <View style={styles.metaRow}>
              <Calendar size={15} color={EventColors.muted} strokeWidth={1.8} />
              <Text style={styles.metaText}>{dt(event.starts_at)}</Text>
            </View>
            <View style={styles.metaRow}>
              <MapPin size={15} color={EventColors.muted} strokeWidth={1.8} />
              <Text style={styles.metaText}>{event.venue}</Text>
            </View>
          </>
        ) : null}
        <View style={styles.codeRow}>
          <Text style={styles.codeLabel}>Credential</Text>
          <Text style={styles.code}>{ticket.credential_id}</Text>
        </View>
        {ticket.state === 'TRANSFERRED' ? (
          <Text style={styles.transferNote}>This ticket has been transferred to another user.</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: EventColors.surface, borderRadius: Radius.xl, overflow: 'hidden', ...shadow2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.lg },
  emoji: { fontSize: 36 },
  title: { ...Typography.titleLg, color: Colors.onPrimary },
  tier: { ...Typography.labelMd, color: Colors.inverseOnSurface, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  badgeText: { ...Typography.labelSm, fontWeight: '700' as const },
  perf: { height: 24, justifyContent: 'center' },
  dashRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24 },
  dash: { width: 8, height: 2, borderRadius: 1, backgroundColor: EventColors.border },
  notch: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.background, top: 0 },
  notchLeft: { left: -12 },
  notchRight: { right: -12 },
  body: { padding: Spacing.lg, gap: Spacing.sm, alignItems: 'stretch' },
  qrWrap: { alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  qrDim: { opacity: 0.5 },
  qrOverlay: { position: 'absolute', top: '40%', backgroundColor: EventColors.text, paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.full },
  qrOverlayText: { ...Typography.labelMd, color: Colors.onPrimary },
  rotating: { ...Typography.caption, color: EventColors.muted },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  metaText: { ...Typography.bodySm, color: EventColors.text },
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.xs, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: EventColors.border },
  codeLabel: { ...Typography.labelSm, color: EventColors.muted },
  code: { ...Typography.labelLg, color: EventColors.text, letterSpacing: 1 },
  transferNote: { ...Typography.bodySm, color: EventColors.warnText },
});
