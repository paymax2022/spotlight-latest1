import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useEducation, useCompleteOnboardingStep } from '@/features/crowdfunding/hooks/useInvestment';

export default function InvestorEducationScreen() {
  const { data, isLoading, isError, refetch } = useEducation();
  const complete = useCompleteOnboardingStep();

  const finish = () => complete.mutate({ step: 'education' }, { onSuccess: () => goBack('/crowdfunding/investment') });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Investor education" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load lessons" actionLabel="Retry" onAction={refetch} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {(data ?? []).map((m, i) => (
              <View key={m.id} style={styles.card}>
                <View style={styles.head}>
                  <Text style={styles.num}>{i + 1}</Text>
                  <Text style={styles.title}>{m.title}</Text>
                  <View style={styles.mins}><Clock size={12} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.minsText}>{m.minutes}m</Text></View>
                </View>
                <Text style={styles.text}>{m.body}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.footer}>
            <PrimaryButton label="I've read and understood" onPress={finish} loading={complete.isPending} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  num: { ...Typography.labelMd, color: Colors.onPrimary, backgroundColor: Colors.primary, width: 24, height: 24, borderRadius: Radius.full, textAlign: 'center', lineHeight: 24, overflow: 'hidden' },
  title: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  mins: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  minsText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  text: { ...Typography.bodyMd, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
