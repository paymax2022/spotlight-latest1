// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const RESTORED = ['Community posts', 'Facility booking', 'Visitor access', 'Voting & elections', 'Meeting participation'];

export default function RestoredScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: '#f0fdf4' }]}>
      <View style={styles.container}>
        <View style={styles.icon}><Ionicons name="checkmark-circle" size={80} color={colors.secondary.emerald} /></View>
        <Text style={styles.title}>Access Restored!</Text>
        <Text style={styles.sub}>Your account has been fully restored. All features are now available.</Text>
        <View style={styles.card}>
          {RESTORED.map((f, i) => (
            <View key={f} style={[styles.row, i < RESTORED.length - 1 && styles.listBorder]}>
              <Ionicons name="checkmark-circle" size={18} color={colors.secondary.emerald} />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>
        <Pressable style={styles.primaryBtn} onPress={() => router.push('/' as never)}>
          <Text style={styles.primaryBtnText}>Back to Home</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 14 },
  icon: { marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: colors.secondary.emerald },
  sub: { fontSize: 14, color: '#166534', textAlign: 'center', lineHeight: 22 },
  card: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: '#dcfce7' },
  featureText: { fontSize: 14, color: '#166534', fontWeight: '600' },
  primaryBtn: { backgroundColor: colors.secondary.emerald, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%', marginTop: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
