import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HardDrive, Download, Trash2, RefreshCw, CheckCircle2, CloudOff, AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import ProgressBar from '@/features/academy/components/ProgressBar';
import OfflineBanner from '@/features/academy/components/OfflineBanner';
import Chip from '@/features/academy/components/Chip';
import { useConnectivity } from '@/features/academy/offlineQueue';
import { useDownloads, useStorageInfo, useSetDownload, useSyncDownload } from '@/features/academy/hooks';
import type { DownloadedBundle } from '@/features/academy/types';

/** L17 — Downloads / offline library: bundles, storage usage, sync status. */
export default function DownloadsScreen() {
  const downloads = useDownloads();
  const storage = useStorageInfo();
  const setDownload = useSetDownload();
  const sync = useSyncDownload();
  const { pendingCount } = useConnectivity();

  if (downloads.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading library…" /></SafeAreaView>;

  const usedPct = storage.data ? Math.round((storage.data.usedMb / (storage.data.budgetMb || 1)) * 100) : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Downloads" subtitle="Offline library" />
      <OfflineBanner />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Storage */}
        <View style={[styles.storageCard, shadow1]}>
          <View style={styles.storageTop}>
            <View style={styles.storageIcon}><HardDrive size={20} color={Colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.storageTitle}>Storage used</Text>
              <Text style={styles.storageSub}>{storage.data?.usedMb ?? 0}MB of {storage.data?.budgetMb ?? 0}MB · {storage.data?.bundleCount ?? 0} bundles</Text>
            </View>
            <Text style={styles.storagePct}>{usedPct}%</Text>
          </View>
          <ProgressBar pct={usedPct} style={{ marginTop: Spacing.sm }} />
          {pendingCount > 0 ? <Text style={styles.syncNote}>{pendingCount} change{pendingCount > 1 ? 's' : ''} queued to sync</Text> : null}
        </View>

        <Text style={styles.section}>Bundles</Text>
        {downloads.data?.map((d) => (
          <BundleRow
            key={d.id}
            d={d}
            busy={setDownload.isPending || sync.isPending}
            onToggle={() => setDownload.mutate({ bundleId: d.id, download: d.status !== 'downloaded' })}
            onSync={() => sync.mutate(d.id)}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function BundleRow({ d, busy, onToggle, onSync }: { d: DownloadedBundle; busy: boolean; onToggle: () => void; onSync: () => void }) {
  const downloaded = d.status === 'downloaded';
  const updateAvail = d.syncState === 'update_available';
  return (
    <View style={[styles.row, shadow1]}>
      <View style={styles.rowTop}>
        <View style={[styles.rowIcon, { backgroundColor: downloaded ? Colors.iconBgTeal : Colors.surfaceContainerHigh }]}>
          {downloaded ? <CheckCircle2 size={18} color={Colors.teal} /> : <CloudOff size={18} color={Colors.onSurfaceVariant} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{d.name}</Text>
          <Text style={styles.rowSub}>{d.itemCount} items · {d.sizeMb}MB</Text>
        </View>
        {downloaded ? (
          updateAvail
            ? <Chip label="Update available" color={Colors.onWarning} bg={Colors.iconBgGold} small />
            : <Chip label="Synced" color={Colors.teal} bg={Colors.iconBgTeal} small />
        ) : (
          <Chip label="Not downloaded" color={Colors.onSurfaceVariant} bg={Colors.surfaceContainerHigh} small />
        )}
      </View>

      {d.status === 'downloading' ? <ProgressBar pct={d.progressPct} style={{ marginTop: Spacing.sm }} /> : null}
      {d.status === 'failed' ? (
        <View style={styles.failRow}><AlertCircle size={14} color={Colors.error} /><Text style={styles.failText}>Download failed. Retry below.</Text></View>
      ) : null}

      <View style={styles.actions}>
        {downloaded && updateAvail ? (
          <Pressable style={styles.actionBtn} onPress={onSync} disabled={busy}>
            <RefreshCw size={15} color={Colors.secondary} /><Text style={styles.actionText}>Sync update</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.actionBtn} onPress={onToggle} disabled={busy}>
          {downloaded ? <Trash2 size={15} color={Colors.error} /> : <Download size={15} color={Colors.primary} />}
          <Text style={[styles.actionText, downloaded && { color: Colors.error }]}>{downloaded ? 'Remove' : 'Download'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  storageCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  storageTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  storageIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  storageTitle: { ...Typography.titleMd, color: Colors.onSurface },
  storageSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  storagePct: { ...Typography.titleLg, color: Colors.primary },
  syncNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  row: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  failRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.xs },
  failText: { ...Typography.labelSm, color: Colors.error },
  actions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm, justifyContent: 'flex-end' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { ...Typography.labelMd, color: Colors.primary },
});
