// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function ProofRejectedScreen() {
  const router = useRouter();
  const REASON = 'The uploaded screenshot does not clearly show the transaction amount and reference number. Please upload a clearer image.';
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.icon}><Ionicons name="close-circle" size={80} color={colors.secondary.red} /></View>
        <Text style={styles.title}>Proof Rejected</Text>
        <View style={styles.reasonCard}>
          <Text style={styles.reasonTitle}>Rejection Reason</Text>
          <Text style={styles.reasonText}>{REASON}</Text>
        </View>
        <Pressable style={styles.primaryBtn} onPress={() => router.push('/estate/ban/proof-upload' as never)}>
          <Ionicons name="camera-outline" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Upload New Proof</Text>
        </Pressable>
        <Pressable style={styles.ghostBtn} onPress={() => router.push('/support' as never)}>
          <Text style={styles.ghostBtnText}>Contact Support</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  container: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 16 },
  icon: { marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: colors.secondary.red },
  reasonCard: { backgroundColor: '#fef2f2', borderRadius: 14, padding: 16, width: '100%', gap: 8 },
  reasonTitle: { fontSize: 13, fontWeight: '700', color: colors.secondary.red },
  reasonText: { fontSize: 14, color: '#991b1b', lineHeight: 22 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, width: '100%' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghostBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%', borderWidth: 1.5, borderColor: colors.neutral.border },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: colors.neutral.textMuted },
});
