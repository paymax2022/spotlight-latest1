import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Video, Phone, MessageCircle, CircleCheck, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { HealthColors, VERTICAL_META, relativeTime } from '../constants/health.constants';
import type { Consult } from '../types';

const MODE_ICON = { video: Video, voice: Phone, chat: MessageCircle } as const;
const MODE_LABEL = { video: 'Video consult', voice: 'Voice consult', chat: 'Chat consult' } as const;

/**
 * Tele-consult lobby card: who you're consulting, mode, scheduled time, and the
 * provider's readiness state (drives lobby copy).
 */
export default function ConsultLobbyCard({ consult }: { consult: Consult }) {
  const vMeta = VERTICAL_META[consult.vertical];
  const ModeIcon = MODE_ICON[consult.mode];

  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: vMeta.iconBg }]}>
          <Text style={[styles.avatarText, { color: vMeta.color }]}>
            {consult.providerName.replace(/^Dr\.?\s*/, '').charAt(0)}
          </Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {consult.providerName}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {vMeta.label} · for {consult.subjectName}
          </Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaChip}>
          <ModeIcon size={14} color={Colors.onSurface} strokeWidth={2} />
          <Text style={styles.metaText}>{MODE_LABEL[consult.mode]}</Text>
        </View>
        <View style={styles.metaChip}>
          <Clock size={14} color={Colors.onSurface} strokeWidth={2} />
          <Text style={styles.metaText}>{relativeTime(consult.scheduledAt)}</Text>
        </View>
      </View>

      <View style={[styles.ready, consult.providerReady ? styles.readyOn : styles.readyOff]}>
        {consult.providerReady ? (
          <>
            <CircleCheck size={16} color={HealthColors.ok} strokeWidth={2.2} />
            <Text style={[styles.readyText, { color: HealthColors.ok }]}>
              Your provider is ready in the lobby
            </Text>
          </>
        ) : (
          <>
            <Clock size={16} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
            <Text style={[styles.readyText, { color: Colors.onSurfaceVariant }]}>
              Waiting for your provider to join…
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: { width: 48, height: 48, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.titleLg },
  info: { flex: 1 },
  name: { ...Typography.titleMd, fontSize: 17, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', gap: Spacing.sm },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 6,
  },
  metaText: { ...Typography.labelSm, color: Colors.onSurface },
  ready: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.sm + 2,
  },
  readyOn: { backgroundColor: HealthColors.okBg },
  readyOff: { backgroundColor: Colors.surfaceContainerLow },
  readyText: { ...Typography.labelMd, flex: 1 },
});
