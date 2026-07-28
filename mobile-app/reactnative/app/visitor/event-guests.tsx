import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { PartyPopper, Users, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useCreateEventGuests } from '@/features/visitor/hooks/useVisitor';
import { formatCodeValue, formatDateTime } from '@/features/visitor/utils/visitorFormatters';
import type { EventGuestManifest } from '@/features/visitor/types/visitor.types';

export default function EventGuestsScreen() {
  const create = useCreateEventGuests();
  const [eventName, setEventName] = useState('');
  const [guestText, setGuestText] = useState('');
  const [days, setDays] = useState(1);
  const [error, setError] = useState('');
  const [manifest, setManifest] = useState<EventGuestManifest | null>(null);

  const guestCount = guestText.split('\n').map((s) => s.trim()).filter(Boolean).length;

  const submit = () => {
    setError('');
    const names = guestText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!eventName.trim() || names.length === 0) {
      setError('Enter an event name and at least one guest (one per line).');
      return;
    }
    const validityStart = new Date().toISOString();
    const validityEnd = new Date(Date.now() + days * 24 * 3_600_000).toISOString();
    create.mutate(
      { eventName: eventName.trim(), guestNames: names, validityStart, validityEnd },
      { onSuccess: setManifest, onError: (e) => setError(e instanceof Error ? e.message : 'Could not create codes.') },
    );
  };

  if (manifest) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={manifest.eventName} subtitle={`${manifest.guests.length} guest codes`} showBack={false} />
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.successBanner}>
            <CircleCheck size={22} color={Colors.teal} strokeWidth={1.8} />
            <Text style={styles.successText}>Guest list created · valid until {formatDateTime(manifest.validityEnd)}</Text>
          </View>
          <View style={styles.card}>
            {manifest.guests.map((g, i) => (
              <View key={g.codeValue} style={[styles.guestRow, i > 0 && styles.guestDivider]}>
                <Text style={styles.guestName} numberOfLines={1}>{g.name}</Text>
                <Text style={styles.guestCode}>{formatCodeValue(g.codeValue)}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="View in active codes" onPress={() => router.replace('/visitor/active')} />
          <PrimaryButton label="Done" variant="secondary" onPress={() => router.replace('/visitor')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Event guest list" subtitle="Bulk codes" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={[styles.hero, { backgroundColor: Colors.iconBgBlue }]}>
            <PartyPopper size={24} color={Colors.secondary} strokeWidth={1.8} />
            <Text style={styles.heroText}>Generate one access code per guest for an event.</Text>
          </View>

          <TextInputField label="Event name" placeholder="e.g. Block C Birthday Party" value={eventName} onChangeText={setEventName} autoCapitalize="words" />
          <TextInputField
            label={`Guest names (one per line)${guestCount ? ` · ${guestCount}` : ''}`}
            placeholder={'Amaka Obi\nChidi Nwosu\nNgozi Okeke'}
            value={guestText}
            onChangeText={setGuestText}
            multiline
            numberOfLines={6}
            style={styles.namesInput}
          />

          <Text style={styles.label}>Valid for</Text>
          <View style={styles.presetRow}>
            {[1, 2, 3].map((d) => {
              const selected = d === days;
              return (
                <Pressable
                  key={d}
                  onPress={() => setDays(d)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[styles.preset, selected && styles.presetSelected]}
                >
                  <Text style={[styles.presetText, selected && styles.presetTextSelected]}>{d} day{d > 1 ? 's' : ''}</Text>
                </Pressable>
              );
            })}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label={guestCount ? `Generate ${guestCount} codes` : 'Generate codes'} onPress={submit} loading={create.isPending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.lg, padding: Spacing.md },
  heroText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  namesInput: { minHeight: 130, textAlignVertical: 'top', paddingTop: Spacing.sm },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  presetRow: { flexDirection: 'row', gap: Spacing.sm },
  preset: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  presetSelected: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.secondary },
  presetText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  presetTextSelected: { color: Colors.secondary },
  error: { ...Typography.labelMd, color: Colors.error },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, gap: Spacing.sm },
  successBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md },
  successText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, ...shadow1 },
  guestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm + 2 },
  guestDivider: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
  guestName: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  guestCode: { ...Typography.labelLg, color: Colors.secondary, letterSpacing: 1 },
});
