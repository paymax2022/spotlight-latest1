// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function RateVendorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  const { data: ticket } = useQuery({
    queryKey: ['repair', id],
    queryFn: async () => {
      const res = await fetch(`/api/repairs/${id}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!id,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/repairs/${id}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      Alert.alert('Thanks!', 'Your rating has been submitted.', [{ text: 'OK', onPress: () => router.back() }]);
    },
    onError: () => Alert.alert('Error', 'Failed to submit rating.'),
  });

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Rate Service</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.vendorCard}>
          <View style={s.avatar}>
            <Text style={s.avatarTxt}>{ticket?.vendor?.name?.split(' ').map((n) => n[0]).join('').slice(0, 2) ?? 'V'}</Text>
          </View>
          <Text style={s.vendorName}>{ticket?.vendor?.name ?? 'Vendor'}</Text>
          <Text style={s.jobSummary}>{ticket?.title ?? 'Repair Job'}</Text>
        </View>

        <View style={s.starsCard}>
          <Text style={s.starsLabel}>How would you rate the service?</Text>
          <View style={s.starsRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setRating(n)} style={s.starBtn}>
                <Ionicons
                  name={n <= rating ? 'star' : 'star-outline'}
                  size={40}
                  color={n <= rating ? '#f59e0b' : colors.neutral.border}
                />
              </Pressable>
            ))}
          </View>
          <Text style={s.ratingHint}>
            {rating === 0 ? 'Tap a star to rate' : ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating]}
          </Text>
        </View>

        <Text style={s.label}>Comment (optional)</Text>
        <TextInput
          style={[s.input, { height: 100, textAlignVertical: 'top' }]}
          placeholder="Share your experience..."
          placeholderTextColor={colors.neutral.placeholder}
          value={comment}
          onChangeText={setComment}
          multiline
          numberOfLines={4}
        />

        <Pressable
          style={[s.submitBtn, (rating === 0 || mutation.isPending) && { opacity: 0.5 }]}
          onPress={() => mutation.mutate()}
          disabled={rating === 0 || mutation.isPending}
        >
          <Text style={s.submitBtnTxt}>{mutation.isPending ? 'Submitting…' : 'Submit Rating'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  vendorCard: { backgroundColor: colors.neutral.surface, borderRadius: 20, padding: 24, alignItems: 'center', gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: '#fff', fontWeight: '800', fontSize: 24 },
  vendorName: { fontSize: 18, fontWeight: '700', color: colors.neutral.text },
  jobSummary: { fontSize: 13, color: colors.neutral.textMuted },
  starsCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 20, alignItems: 'center', gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  starsLabel: { fontSize: 15, fontWeight: '600', color: colors.neutral.text },
  starsRow: { flexDirection: 'row', gap: 8 },
  starBtn: { padding: 4 },
  ratingHint: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '500' },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  submitBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  submitBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
