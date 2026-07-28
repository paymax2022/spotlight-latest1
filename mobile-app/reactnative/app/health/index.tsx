import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ChevronRight, ShieldCheck, FileHeart, Video, Stethoscope } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { HealthHubTile, RecordCard } from '@/features/health/components';
import { useHubSummary } from '@/features/health/hooks';
import { VERTICAL_META, NDPA_CONSENT_COPY } from '@/features/health/constants/health.constants';
import type { Vertical } from '@/features/health/types';

const VERTICALS: Vertical[] = ['pharmacy', 'lab', 'vet'];

export default function HealthHubScreen() {
  const { data, isLoading, isError, refetch } = useHubSummary();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Health"
        subtitle="Your connected care loop"
        rightSlot={
          <Pressable onPress={() => router.push('/health/consent')} hitSlop={8} accessibilityLabel="Consent & privacy">
            <ShieldCheck size={22} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading your health hub…" />
      ) : isError || !data ? (
        <StateView
          kind="error"
          title="Couldn't load Health"
          message="Please check your connection and try again."
          actionLabel="Retry"
          onAction={refetch}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Symptom Checker — the front door to the care loop (triage, not diagnosis) */}
          <Pressable
            style={[styles.symptomCard, shadow1]}
            onPress={() => router.push('/health/triage')}
            accessibilityRole="button"
            accessibilityLabel="Symptom Checker"
          >
            <View style={styles.symptomIcon}>
              <Stethoscope size={24} color={Colors.onPrimary} strokeWidth={2} />
            </View>
            <View style={styles.symptomBody}>
              <Text style={styles.symptomTitle}>Symptom Checker</Text>
              <Text style={styles.symptomSub} numberOfLines={2}>
                Check your symptoms in your language — guidance on what to do next, not a diagnosis.
              </Text>
            </View>
            <ChevronRight size={20} color={Colors.onPrimary} strokeWidth={2} />
          </Pressable>

          {/* Care-loop entry tiles */}
          <View style={styles.tilesRow}>
            {VERTICALS.map((v) => (
              <HealthHubTile key={v} vertical={v} onPress={() => router.push(VERTICAL_META[v].href as never)} />
            ))}
          </View>

          {/* NDPA consent assurance (HL-8) */}
          <Pressable style={[styles.ndpa, shadow1]} onPress={() => router.push('/health/consent')}>
            <View style={styles.ndpaIcon}>
              <ShieldCheck size={18} color={Colors.teal} strokeWidth={2} />
            </View>
            <View style={styles.ndpaText}>
              <Text style={styles.ndpaTitle}>Your data, your control</Text>
              <Text style={styles.ndpaBody} numberOfLines={2}>
                {NDPA_CONSENT_COPY}
              </Text>
            </View>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>

          {/* Active consults */}
          {data.activeConsults.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Active consults</Text>
              {data.activeConsults.map((c) => (
                <Pressable
                  key={c.id}
                  style={[styles.summaryRow, shadow1]}
                  onPress={() => router.push({ pathname: '/health/consult/lobby', params: { consultId: c.id } })}
                >
                  <View style={[styles.summaryIcon, { backgroundColor: Colors.iconBgPurple }]}>
                    <Video size={18} color={Colors.primary} strokeWidth={2} />
                  </View>
                  <View style={styles.summaryBody}>
                    <Text style={styles.summaryTitle} numberOfLines={1}>
                      {c.providerName} · {c.subjectName}
                    </Text>
                    <Text style={styles.summarySub}>Tap to enter the lobby</Text>
                  </View>
                  <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* Active orders */}
          {data.activeOrders.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Active orders</Text>
              {data.activeOrders.map((o) => {
                const meta = VERTICAL_META[o.vertical];
                const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.Activity;
                return (
                  <Pressable key={o.id} style={[styles.summaryRow, shadow1]} onPress={() => router.push(o.href as never)}>
                    <View style={[styles.summaryIcon, { backgroundColor: meta.iconBg }]}>
                      <Icon size={18} color={meta.color} strokeWidth={2} />
                    </View>
                    <View style={styles.summaryBody}>
                      <Text style={styles.summaryTitle} numberOfLines={1}>
                        {o.title}
                      </Text>
                      <Text style={styles.summarySub}>{o.statusLabel}</Text>
                    </View>
                    <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {/* Recent records */}
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Recent records</Text>
              <Pressable onPress={() => router.push('/health/records')} hitSlop={8}>
                <Text style={styles.link}>View all</Text>
              </Pressable>
            </View>
            {data.recentRecords.length === 0 ? (
              <StateView
                kind="empty"
                compact
                icon="FileHeart"
                title="No records yet"
                message="Records from your consults, prescriptions and lab tests appear here."
              />
            ) : (
              <View style={styles.recordList}>
                {data.recentRecords.map((r) => (
                  <RecordCard
                    key={r.id}
                    record={r}
                    showSubject
                    onPress={() => router.push({ pathname: '/health/records/[id]', params: { id: r.id } })}
                  />
                ))}
              </View>
            )}
          </View>

          {/* Records vault entry */}
          <Pressable style={[styles.vaultCta, shadow1]} onPress={() => router.push('/health/records')}>
            <FileHeart size={20} color={Colors.onPrimary} strokeWidth={2} />
            <Text style={styles.vaultText}>Open your records vault</Text>
            <ChevronRight size={18} color={Colors.onPrimary} strokeWidth={2} />
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: 100, gap: Spacing.lg },
  tilesRow: { flexDirection: 'row', gap: Spacing.md },
  symptomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  symptomIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  symptomBody: { flex: 1 },
  symptomTitle: { ...Typography.titleMd, color: Colors.onPrimary },
  symptomSub: { ...Typography.labelSm, color: Colors.onPrimary, opacity: 0.92, lineHeight: 16 },
  ndpa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  ndpaIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgTeal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ndpaText: { flex: 1 },
  ndpaTitle: { ...Typography.labelLg, color: Colors.onSurface },
  ndpaBody: { ...Typography.caption, color: Colors.onSurfaceVariant, lineHeight: 15 },
  section: { gap: Spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...Typography.titleLg, color: Colors.onSurface },
  link: { ...Typography.labelMd, color: Colors.secondary },
  recordList: { gap: Spacing.sm },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  summaryIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  summaryBody: { flex: 1 },
  summaryTitle: { ...Typography.labelLg, color: Colors.onSurface },
  summarySub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  vaultCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  vaultText: { ...Typography.labelLg, color: Colors.onPrimary, flex: 1 },
});
