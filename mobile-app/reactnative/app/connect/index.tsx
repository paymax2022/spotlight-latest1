import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/colors';
import { useConnectConfig } from '@/features/connect/hooks/useConnect';
import { ConnectColors } from '@/features/connect/constants/connect.constants';

// Phase 0 Connect shell: confirms the module is wired and renders the
// backend-owned config the app reads (never hard-codes).
export default function ConnectHome() {
  const { data, isLoading, error } = useConnectConfig();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>PAYMAX</Text>
        <Text style={styles.title}>Connect</Text>
        <Text style={styles.subtitle}>
          Trust-first, verified, 18+ connections. Profile modes, discovery and safe chat arrive in Phase 1.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Backend config</Text>
          {isLoading ? (
            <ActivityIndicator color={ConnectColors.brand} style={{ marginVertical: 12 }} />
          ) : error ? (
            <Text style={styles.error}>Couldn’t load config.</Text>
          ) : (
            Object.entries(data ?? {}).map(([k, v]) => (
              <View key={k} style={styles.row}>
                <Text style={styles.rowKey}>{k}</Text>
                <Text style={styles.rowVal}>{JSON.stringify(v)}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20, paddingBottom: 40 },
  kicker: { color: ConnectColors.accent, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  title: { color: ConnectColors.brand, fontSize: 32, fontWeight: '800', marginTop: 2 },
  subtitle: { color: ConnectColors.muted, fontSize: 15, lineHeight: 22, marginTop: 8 },
  card: {
    backgroundColor: ConnectColors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ConnectColors.border,
    padding: 16,
    marginTop: 24,
  },
  cardTitle: { color: ConnectColors.text, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#EFF4FF' },
  rowKey: { color: ConnectColors.muted, fontSize: 13, flex: 1 },
  rowVal: { color: ConnectColors.text, fontSize: 13, fontWeight: '600', marginLeft: 12 },
  error: { color: ConnectColors.danger, fontSize: 14, marginVertical: 8 },
});
