// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { useState } from 'react';

export default function AppealScreen() {
  const router = useRouter();
  const [reason, setReason] = useState('');

  const handleSubmit = () => {
    if (!reason.trim()) { Alert.alert('Required', 'Please provide a reason for your appeal.'); return; }
    Alert.alert('Appeal Submitted', 'Your appeal has been submitted. Admin will review within 24 hours.', [{ text: 'OK', onPress: () => router.back() }]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Appeal Restriction</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={20} color={colors.secondary.DEFAULT} />
          <Text style={styles.infoText}>Appeals are reviewed by estate admin within 24 hours. Provide supporting evidence where possible.</Text>
        </View>

        <Text style={styles.label}>Reason for Appeal</Text>
        <TextInput
          style={styles.textarea}
          placeholder="Explain why you believe this restriction should be lifted..."
          placeholderTextColor={colors.neutral.placeholder}
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
        />

        <Pressable style={styles.uploadBtn} onPress={() => router.push('/estate/ban/proof-upload' as never)}>
          <Ionicons name="attach-outline" size={20} color={colors.primary.DEFAULT} />
          <Text style={styles.uploadBtnText}>Upload Supporting Document</Text>
        </Pressable>

        <View style={styles.noticeCard}>
          <Ionicons name="time-outline" size={16} color={colors.neutral.textMuted} />
          <Text style={styles.noticeText}>Admin reviews appeals within 24 hours. You will be notified of the outcome.</Text>
        </View>

        <Pressable style={styles.primaryBtn} onPress={handleSubmit}>
          <Text style={styles.primaryBtnText}>Submit Appeal</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16 },
  infoCard: { backgroundColor: '#eff6ff', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoText: { fontSize: 13, color: colors.secondary.DEFAULT, flex: 1, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  textarea: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, fontSize: 14, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border, minHeight: 130 },
  uploadBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderWidth: 1.5, borderColor: colors.neutral.border },
  uploadBtnText: { fontSize: 15, fontWeight: '600', color: colors.primary.DEFAULT },
  noticeCard: { backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12, padding: 12, flexDirection: 'row', gap: 8 },
  noticeText: { fontSize: 12, color: colors.neutral.textMuted, flex: 1, lineHeight: 18 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
