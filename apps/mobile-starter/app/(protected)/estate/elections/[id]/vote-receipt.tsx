// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function VoteReceipt() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [receipt, setReceipt] = useState({
    reference: `VT-${Date.now().toString(36).toUpperCase()}`,
    election_title: 'Estate Election',
    positions_voted: [],
    voted_at: new Date().toISOString(),
  });

  useEffect(() => {
    // Attempt to fetch latest receipt
    fetch(`/api/estate/elections/${id}/my-vote`)
      .then(r => r.json())
      .then(d => d.data && setReceipt(d.data))
      .catch(() => {});
  }, [id]);

  async function handleShare() {
    await Share.share({
      message: `I voted in ${receipt.election_title}! Reference: ${receipt.reference}. Verify at paymax.ng/verify/${receipt.reference}`,
    });
  }

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <View style={{ width: 38 }} />
        <Text style={s.hTitle}>Vote Receipt</Text>
        <Pressable style={s.hBtn} onPress={handleShare}>
          <Ionicons name="share-social-outline" size={20} color="#fff" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.successSection}>
          <View style={s.checkCircle}>
            <Ionicons name="checkmark" size={36} color="#fff" />
          </View>
          <Text style={s.successTitle}>Vote Submitted!</Text>
          <Text style={s.successSubtitle}>Your vote has been recorded securely.</Text>
        </View>

        <View style={s.card}>
          <View style={s.row}>
            <Text style={s.rowLabel}>Reference</Text>
            <Text style={s.rowValue}>{receipt.reference}</Text>
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <Text style={s.rowLabel}>Election</Text>
            <Text style={s.rowValue}>{receipt.election_title}</Text>
          </View>
          <View style={s.divider} />
          {receipt.positions_voted?.length > 0 && (
            <>
              <View style={s.row}>
                <Text style={s.rowLabel}>Voted For</Text>
                <View>
                  {receipt.positions_voted.map((pos, i) => (
                    <Text key={i} style={s.rowValue}>{pos}</Text>
                  ))}
                </View>
              </View>
              <View style={s.divider} />
            </>
          )}
          <View style={s.row}>
            <Text style={s.rowLabel}>Date & Time</Text>
            <Text style={s.rowValue}>{new Date(receipt.voted_at).toLocaleString()}</Text>
          </View>
        </View>

        <View style={s.secrecyNote}>
          <Ionicons name="lock-closed-outline" size={16} color={colors.primary.DEFAULT} />
          <Text style={s.secrecyText}>Your candidate choices are kept confidential to protect ballot secrecy.</Text>
        </View>

        <Pressable style={s.primaryBtn} onPress={() => router.replace('/estate/elections' as never)}>
          <Text style={s.primaryBtnText}>Back to Elections</Text>
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
  successSection: { alignItems: 'center', paddingVertical: 36 },
  checkCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.secondary.emerald, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  successTitle: { fontSize: 24, fontWeight: '700', color: colors.neutral.text, marginBottom: 8 },
  successSubtitle: { fontSize: 14, color: colors.neutral.textMuted },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.neutral.border },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 10 },
  rowLabel: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '600' },
  rowValue: { fontSize: 13, color: colors.neutral.text, fontWeight: '700', textAlign: 'right', maxWidth: '60%' },
  divider: { height: 1, backgroundColor: colors.neutral.border },
  secrecyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 10, padding: 12, marginBottom: 24 },
  secrecyText: { fontSize: 13, color: colors.neutral.textMuted, flex: 1, lineHeight: 19 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
