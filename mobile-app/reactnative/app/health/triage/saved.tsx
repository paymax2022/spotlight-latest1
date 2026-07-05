import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, BellRing, Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import { TriageScaffold } from '@/features/triage/components';
import { useSaveToRecords, useSubmitFeedback } from '@/features/triage/hooks';
import { useLanguage } from '@/features/triage/useLanguage';
import { t } from '@/features/triage/i18n';

export default function TriageSavedScreen() {
  const params = useLocalSearchParams<{ sessionId?: string; route?: string }>();
  const sessionId = params.sessionId;
  const [lang, setLang] = useLanguage();
  const s = t(lang);

  const save = useSaveToRecords();
  const feedback = useSubmitFeedback();
  const [rating, setRating] = useState(0);
  const [reminderOn, setReminderOn] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);

  // Save the session to the records vault on mount (idempotent in the mock).
  useEffect(() => {
    if (sessionId) save.mutate(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const submitRating = (value: number) => {
    setRating(value);
    if (!sessionId) return;
    feedback.mutate({ sessionId, rating: value }, { onSuccess: () => setFeedbackSent(true) });
  };

  return (
    <TriageScaffold title={s.done} lang={lang} onChangeLang={setLang} sessionId={sessionId} onBack={() => router.replace('/health')}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Saved confirmation */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <CircleCheck size={40} color={Colors.teal} strokeWidth={2} />
          </View>
          <Text style={styles.heroTitle}>{s.savedToRecords}</Text>
          <Text style={styles.heroSub}>
            You can view this summary any time in your health records vault.
          </Text>
        </View>

        {/* Follow-up reminder */}
        <Pressable
          onPress={() => setReminderOn((r) => !r)}
          style={[styles.card, shadow1]}
          accessibilityRole="switch"
          accessibilityState={{ checked: reminderOn }}
        >
          <View style={[styles.cardIcon, { backgroundColor: Colors.iconBgGold }]}>
            <BellRing size={20} color={Colors.onWarning} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{s.setReminder}</Text>
            <Text style={styles.cardSub}>We'll check in: "How are you feeling now?" in 2 days.</Text>
          </View>
          <View style={[styles.toggle, reminderOn && styles.toggleOn]}>
            <View style={[styles.knob, reminderOn && styles.knobOn]} />
          </View>
        </Pressable>

        {/* Feedback rating */}
        <View style={[styles.card, styles.feedbackCard, shadow1]}>
          <Text style={styles.cardTitle}>{s.rateThis}</Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => submitRating(n)} hitSlop={6} accessibilityLabel={`${n} star`}>
                <Star
                  size={32}
                  color={n <= rating ? Colors.gold : Colors.outlineVariant}
                  fill={n <= rating ? Colors.gold : 'transparent'}
                  strokeWidth={2}
                />
              </Pressable>
            ))}
          </View>
          {feedbackSent ? <Text style={styles.thanks}>Thanks for your feedback.</Text> : null}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Back to Health" onPress={() => router.replace('/health')} />
      </View>
    </TriageScaffold>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  heroIcon: {
    width: 80, height: 80, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal,
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
  },
  cardIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  cardSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  toggle: { width: 44, height: 26, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHighest, padding: 3, justifyContent: 'center' },
  toggleOn: { backgroundColor: Colors.primary },
  knob: { width: 20, height: 20, borderRadius: Radius.full, backgroundColor: Colors.white },
  knobOn: { alignSelf: 'flex-end' },
  feedbackCard: { flexDirection: 'column', alignItems: 'flex-start', gap: Spacing.sm },
  stars: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  thanks: { ...Typography.bodySm, color: Colors.teal },
  footer: {
    padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
});
