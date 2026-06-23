// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function ConfirmVote() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  // In practice, selections would be passed via state/store
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      // Vote submission handled here or delegated from vote.tsx
      await new Promise(r => setTimeout(r, 1000)); // placeholder
      router.replace(`/estate/elections/${id}/vote-receipt` as never);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.hTitle}>Confirm Vote</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.iconRow}>
          <View style={s.iconCircle}>
            <Ionicons name="checkmark-circle-outline" size={48} color={colors.primary.DEFAULT} />
          </View>
          <Text style={s.pageTitle}>Review Your Selections</Text>
          <Text style={s.pageSubtitle}>Please confirm your choices below before submitting.</Text>
        </View>

        {/* Placeholder review rows — in production these come from navigation state */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Your Vote Summary</Text>
          <View style={s.reviewRow}>
            <Text style={s.reviewPos}>President</Text>
            <Text style={s.reviewCandidate}>Selected Candidate</Text>
          </View>
          <View style={s.reviewRow}>
            <Text style={s.reviewPos}>Secretary</Text>
            <Text style={s.reviewCandidate}>Selected Candidate</Text>
          </View>
        </View>

        <View style={s.warningCard}>
          <Ionicons name="warning" size={18} color={colors.secondary.red} />
          <Text style={s.warningText}>This vote is final and cannot be changed once submitted.</Text>
        </View>

        <Pressable style={s.submitBtn} onPress={handleSubmit} disabled={submitting}>
          {submitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={s.submitBtnText}>Submit Vote</Text>
          )}
        </Pressable>

        <Pressable style={s.ghostBtn} onPress={() => router.back()}>
          <Text style={s.ghostBtnText}>Go Back to Change</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  body: { padding: 16, paddingBottom: 40 },
  iconRow: { alignItems: 'center', paddingVertical: 24 },
  iconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  pageTitle: { fontSize: 20, fontWeight: '700', color: colors.neutral.text, marginBottom: 6, textAlign: 'center' },
  pageSubtitle: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 20 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 16, marginVertical: 20, borderWidth: 1, borderColor: colors.neutral.border },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.neutral.textMuted, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  reviewPos: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '600' },
  reviewCandidate: { fontSize: 14, color: colors.neutral.text, fontWeight: '700' },
  warningCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fef2f2', borderRadius: 10, padding: 14, marginBottom: 24, borderWidth: 1, borderColor: '#fecaca' },
  warningText: { fontSize: 13, color: colors.secondary.red, fontWeight: '600', flex: 1, lineHeight: 18 },
  submitBtn: { backgroundColor: colors.secondary.emerald, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  submitBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  ghostBtn: { borderWidth: 1, borderColor: colors.neutral.border, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  ghostBtnText: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '600' },
});
