// @ts-nocheck
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { syncOfflineLogs } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const OFFLINE_LOG_KEY = 'paymax.guard.offline_logs';

export default function OfflineScreen() {
  const { data: pendingLogs = [], refetch } = useQuery({
    queryKey: ['offline-guard-logs'],
    queryFn: async () => {
      const raw = await AsyncStorage.getItem(OFFLINE_LOG_KEY);
      return raw ? JSON.parse(raw) : [];
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      const result = await syncOfflineLogs(ctx.estateId, pendingLogs);
      await AsyncStorage.removeItem(OFFLINE_LOG_KEY);
      return result;
    },
    onSuccess: (r) => {
      refetch();
      Alert.alert('Synced', `${r.synced} log${r.synced !== 1 ? 's' : ''} uploaded successfully.`);
    },
    onError: (e: any) => Alert.alert('Sync Failed', e?.message ?? 'Check your connection and try again'),
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      await AsyncStorage.removeItem(OFFLINE_LOG_KEY);
    },
    onSuccess: () => { refetch(); Alert.alert('Cleared', 'Offline logs discarded.'); },
  });

  function confirmClear() {
    Alert.alert('Discard Logs', `This will permanently delete ${pendingLogs.length} pending log${pendingLogs.length !== 1 ? 's' : ''}. Are you sure?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => clearMutation.mutate() },
    ]);
  }

  const hasPending = pendingLogs.length > 0;

  return (
    <SafeAreaView style={[styles.safe, styles.center]}>
      <View style={[styles.iconWrap, { backgroundColor: hasPending ? '#FEF9C3' : '#F0FDF4' }]}>
        <Ionicons
          name={hasPending ? 'cloud-offline-outline' : 'cloud-done-outline'}
          size={52}
          color={hasPending ? '#D97706' : '#10B981'}
        />
      </View>

      <Text style={styles.heading}>{hasPending ? 'Offline Logs Pending' : 'All Synced'}</Text>
      <Text style={styles.sub}>
        {hasPending
          ? `${pendingLogs.length} gate event${pendingLogs.length !== 1 ? 's' : ''} captured offline and waiting to upload.`
          : 'No pending offline gate logs. All events have been uploaded.'
        }
      </Text>

      {hasPending && (
        <View style={styles.logList}>
          {pendingLogs.slice(0, 5).map((log: any, i: number) => (
            <View key={log.client_id ?? i} style={styles.logRow}>
              <Ionicons name="time-outline" size={14} color={colors.neutral.textMuted} />
              <Text style={styles.logText}>{log.event_type} · {new Date(log.captured_at).toLocaleTimeString('en-NG')}</Text>
            </View>
          ))}
          {pendingLogs.length > 5 && <Text style={styles.moreText}>+{pendingLogs.length - 5} more…</Text>}
        </View>
      )}

      {hasPending && (
        <Pressable
          style={[styles.syncBtn, syncMutation.isPending && styles.disabled]}
          onPress={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
        >
          <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
          <Text style={styles.syncBtnText}>{syncMutation.isPending ? 'Syncing…' : 'Upload Now'}</Text>
        </Pressable>
      )}

      {hasPending && (
        <Pressable style={styles.discardBtn} onPress={confirmClear}>
          <Text style={styles.discardBtnText}>Discard All Logs</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  iconWrap: { width: 110, height: 110, borderRadius: 55, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 22, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  logList: { backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 8, width: '100%' },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logText: { fontSize: 13, color: colors.neutral.textMuted, textTransform: 'capitalize' },
  moreText: { fontSize: 12, color: colors.neutral.placeholder, textAlign: 'center' },
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#10B981', borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14, width: '100%', justifyContent: 'center' },
  syncBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.5 },
  discardBtn: { paddingVertical: 8 },
  discardBtnText: { fontSize: 13, color: '#EF4444', fontWeight: '600' },
});
