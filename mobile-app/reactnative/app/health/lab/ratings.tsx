import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useSubmitReview } from '@/features/health/lab/hooks';

export default function RatingsScreen() {
  const params = useLocalSearchParams<{ orderId?: string; labId?: string; labName?: string }>();
  const submit = useSubmitReview();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Thank you" />
        <StateView
          kind="empty"
          icon="Star"
          title="Review submitted"
          message="Thanks for helping other patients choose a trusted lab."
          actionLabel="Done"
          onAction={() => goBack('/health/lab')}
        />
      </SafeAreaView>
    );
  }

  const onSubmit = async () => {
    await submit.mutateAsync({
      orderId: params.orderId ?? 'unknown',
      labId: params.labId ?? 'unknown',
      rating,
      body,
    });
    setDone(true);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Rate your test" subtitle={params.labName ?? 'Share your experience'} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.prompt}>How was your experience?</Text>
        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => setRating(n)} hitSlop={6} accessibilityLabel={`${n} star`}>
              <Star
                size={40}
                color={n <= rating ? Colors.gold : Colors.outlineVariant}
                fill={n <= rating ? Colors.gold : 'transparent'}
                strokeWidth={2}
              />
            </Pressable>
          ))}
        </View>

        <TextInputField
          label="Add a comment (optional)"
          value={body}
          onChangeText={setBody}
          placeholder="Tell us about the collection, timeliness, results…"
          multiline
          style={styles.input}
        />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Submit review" onPress={onSubmit} disabled={rating === 0} loading={submit.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg },
  prompt: { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.sm },
  input: { minHeight: 100, textAlignVertical: 'top' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
