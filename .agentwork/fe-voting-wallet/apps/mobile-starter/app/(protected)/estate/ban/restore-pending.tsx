// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function RestorePendingScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.infoCard}>
          <Ionicons name="information-circle" size={48} color={colors.secondary.DEFAULT} />
          <Text style={styles.title}>Restoration in Progress</Text>
          <Text style={styles.body}>We've received your payment. Your access will be restored within 5 minutes.</Text>
          <ActivityIndicator color={colors.secondary.DEFAULT} size="large" style={{ marginTop: 8 }} />
        </View>
        <Pressable style={styles.checkBtn} onPress={() => router.replace('/estate/ban/restored' as never)}>
          <Text style={styles.checkBtnText}>Check Status</Text>
        </Pressable>
        <Pressable style={styles.homeBtn} onPress={() => router.push('/' as never)}>
          <Text style={styles.homeBtnText}>Go to Home</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  container: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 16 },
  infoCard: { backgroundColor: '#eff6ff', borderRadius: 20, padding: 28, alignItems: 'center', gap: 12, width: '100%' },
  title: { fontSize: 22, fontWeight: '700', color: colors.secondary.DEFAULT, textAlign: 'center' },
  body: { fontSize: 14, color: colors.secondary.DEFAULT, textAlign: 'center', lineHeight: 22, opacity: 0.8 },
  checkBtn: { backgroundColor: colors.secondary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%' },
  checkBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  homeBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%', borderWidth: 1.5, borderColor: colors.neutral.border },
  homeBtnText: { fontSize: 15, fontWeight: '600', color: colors.neutral.textMuted },
});
