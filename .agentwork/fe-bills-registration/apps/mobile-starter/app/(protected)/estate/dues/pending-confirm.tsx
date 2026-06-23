// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function PendingConfirmScreen() {
  const router = useRouter();
  const ref = 'PMX-TRANSFER-' + Date.now();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Ionicons name="time" size={80} color={colors.secondary.DEFAULT} />
        </View>
        <Text style={styles.title}>Payment Under Review</Text>
        <Text style={styles.body}>Your bank transfer is being verified. This usually takes 1–2 hours.</Text>

        <View style={styles.card}>
          <View style={[styles.row, styles.listBorder]}>
            <Text style={styles.label}>Reference</Text>
            <Text style={styles.value}>{ref}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Pending Verification</Text>
            </View>
          </View>
        </View>

        <Text style={styles.hint}>You will receive a notification once your payment is confirmed.</Text>

        <Pressable style={styles.primaryBtn} onPress={() => router.push('/estate/dues' as never)}>
          <Text style={styles.primaryBtnText}>Go Home</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  container: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 16 },
  iconWrap: { marginBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', color: colors.neutral.text, textAlign: 'center' },
  body: { fontSize: 15, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 24 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  badge: { backgroundColor: '#eff6ff', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700', color: colors.secondary.DEFAULT },
  hint: { fontSize: 13, color: colors.neutral.textMuted, textAlign: 'center' },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
