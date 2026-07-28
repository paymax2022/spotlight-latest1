import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheckBig, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useTrip } from '@/features/stays/trips';

const TOPICS = ['Payment & refund', 'Booking change', 'Property issue', 'App problem', 'Other'];

export default function ContactSupportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id ?? '');
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function submit() {
    if (!message.trim()) return;
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setDone(true);
    }, 900);
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Issue raised" showBack={false} />
        <View style={styles.successWrap}>
          <View style={styles.successIcon}><CircleCheckBig size={48} color={Colors.teal} /></View>
          <Text style={styles.successTitle}>We're on it</Text>
          <Text style={styles.successMsg}>Your issue has been logged. A support agent will respond within a few hours. You'll get updates in your notifications.</Text>
          <View style={styles.successActions}>
            <PrimaryButton label="View notifications" onPress={() => router.replace('/stays/support/notifications')} />
            <PrimaryButton label="Done" variant="secondary" onPress={() => router.replace('/stays/trips')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Contact support" subtitle="Raise an issue" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {trip.data ? (
          <View style={styles.bookingCard}>
            <Text style={styles.bookingLabel}>About booking</Text>
            <Text style={styles.bookingName}>{trip.data.propertyName} · {trip.data.reference}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Topic</Text>
        <View style={styles.topicWrap}>
          {TOPICS.map((t) => {
            const active = topic === t;
            return (
              <Pressable key={t} style={[styles.chip, active && styles.chipActive]} onPress={() => setTopic(t)}>
                {active ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{t}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>How can we help?</Text>
        <TextInput
          style={styles.textarea}
          value={message}
          onChangeText={setMessage}
          placeholder="Describe your issue…"
          placeholderTextColor={Colors.onSurfaceVariant}
          multiline
        />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={submitting ? 'Submitting…' : 'Submit'} loading={submitting} disabled={!message.trim()} onPress={submit} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  bookingCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.sm },
  bookingLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  bookingName: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '600' as const },
  label: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const, marginTop: Spacing.sm },
  topicWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '600' as const },
  chipTextActive: { color: Colors.onPrimary },
  textarea: { minHeight: 140, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, ...Typography.bodyMd, color: Colors.onSurface, textAlignVertical: 'top' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, ...shadow2 },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  successIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  successMsg: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  successActions: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.md },
});
