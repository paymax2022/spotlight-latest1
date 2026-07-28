import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StarRating from '@/features/health/vet/components/StarRating';
import { useSubmitReview } from '@/features/health/vet/hooks';

export default function RatingsScreen() {
  const { vetId, appointmentId } = useLocalSearchParams<{ vetId: string; appointmentId?: string }>();
  const submit = useSubmitReview();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [done, setDone] = useState(false);

  const onSubmit = () => {
    submit.mutate(
      { vetId, appointmentId: appointmentId ?? 'appt', rating, body: body.trim() },
      { onSuccess: () => setDone(true) },
    );
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Thank you" />
        <View style={styles.doneWrap}>
          <View style={styles.doneIcon}>
            <CheckCircle2 size={40} color={Colors.teal} strokeWidth={2} />
          </View>
          <Text style={styles.doneTitle}>Review submitted</Text>
          <Text style={styles.doneSub}>Thanks for helping other pet owners.</Text>
          <PrimaryButton label="Done" onPress={() => router.replace('/health/vet')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Rate your vet" />
      <View style={styles.content}>
        <Text style={styles.prompt}>How was your consult?</Text>
        <View style={styles.starsWrap}>
          <StarRating rating={rating} size={36} onChange={setRating} />
        </View>
        <TextInputField
          label="Share more (optional)"
          placeholder="What went well? What could be better?"
          value={body}
          onChangeText={setBody}
          multiline
        />
        <PrimaryButton label="Submit review" onPress={onSubmit} disabled={rating === 0} loading={submit.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg },
  prompt: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.md },
  starsWrap: { alignItems: 'center' },
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  doneIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  doneSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.md },
});
