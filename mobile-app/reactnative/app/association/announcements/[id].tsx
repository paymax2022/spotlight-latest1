import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { AlertTriangle, Megaphone, FileText, Users, CheckCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useAnnouncement, useAcknowledgeAnnouncement } from '@/features/association/hooks/useEngagement';
import { formatDateTime } from '@/features/association/utils/associationFormatters';

export default function AnnouncementDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ann = useAnnouncement(id);
  const ack = useAcknowledgeAnnouncement();

  if (ann.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Announcement" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (ann.isError || !ann.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Announcement" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => ann.refetch()} />
      </SafeAreaView>
    );
  }

  const a = ann.data;
  const acknowledged = a.acknowledged || ack.isSuccess;
  const attachments = a.attachments ?? [];
  // Read receipts are optional on the live DTO — hide the card rather than
  // rendering "Read by undefined of undefined members".
  const hasReadStats = typeof a.readCount === 'number' && typeof a.totalRecipients === 'number';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Announcement" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {a.urgent ? (
          <View style={styles.urgentBanner}>
            <AlertTriangle size={16} color={Colors.error} strokeWidth={2} />
            <Text style={styles.urgentText}>Urgent announcement</Text>
          </View>
        ) : null}

        <Text style={styles.title}>{a.title}</Text>

        <View style={styles.metaRow}>
          <View style={styles.authorBadge}><Megaphone size={14} color={Colors.primary} strokeWidth={2} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.author}>{a.author}</Text>
            <Text style={styles.meta}>{a.audience} · {formatDateTime(a.postedAt)}</Text>
          </View>
        </View>

        <Text style={styles.body}>{a.body}</Text>

        {attachments.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Attachments</Text>
            <View style={styles.gap8}>
              {attachments.map((att) => (
                <Pressable key={att.id} style={[styles.attRow, shadow1]} accessibilityRole="button" accessibilityLabel={`Open ${att.name}`}>
                  <FileText size={18} color={Colors.secondary} strokeWidth={2} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.attName} numberOfLines={1}>{att.name}</Text>
                    <Text style={styles.attMeta}>{att.sizeLabel}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {/* Read receipt insight */}
        {hasReadStats ? (
          <View style={[styles.readCard, shadow1]}>
            <Users size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.readText}>
              Read by {(a.readCount ?? 0).toLocaleString('en-NG')} of {(a.totalRecipients ?? 0).toLocaleString('en-NG')} members
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {a.requiresAck ? (
        <View style={styles.footer}>
          {acknowledged ? (
            <View style={styles.ackDone}>
              <CheckCheck size={18} color={Colors.teal} strokeWidth={2.4} />
              <Text style={styles.ackDoneText}>You acknowledged this announcement</Text>
            </View>
          ) : (
            <PrimaryButton label="Acknowledge" onPress={() => ack.mutate(a.id)} loading={ack.isPending} />
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120, gap: Spacing.md },
  urgentBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.errorContainer, borderRadius: Radius.md, padding: Spacing.sm, alignSelf: 'flex-start', paddingHorizontal: Spacing.md },
  urgentText: { ...Typography.labelSm, color: Colors.error, fontWeight: '700' as const },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  authorBadge: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  author: { ...Typography.labelMd, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  body: { ...Typography.bodyMd, color: Colors.onSurface },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  gap8: { gap: Spacing.sm },
  attRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  attName: { ...Typography.labelMd, color: Colors.onSurface },
  attMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  readCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.xs },
  readText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  ackDone: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  ackDoneText: { ...Typography.labelMd, color: Colors.teal },
});
