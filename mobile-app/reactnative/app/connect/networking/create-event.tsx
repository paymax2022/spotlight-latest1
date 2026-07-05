import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import ToggleRow from '@/features/connect/components/ToggleRow';
import { useCreateEvent } from '@/features/connect/networking/hooks';
import type { CreateEventInput } from '@/features/connect/networking/types';

/**
 * Create an event (PRD §10.3 NW-10). Price is entered in naira and converted to
 * kobo (×100) — money is ALWAYS stored as kobo.
 */
export default function CreateEventScreen() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [venue, setVenue] = useState('');
  const [city, setCity] = useState('');
  const [isOnline, setIsOnline] = useState(false);
  const [priceNaira, setPriceNaira] = useState('');

  const create = useCreateEvent();

  const canSubmit =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    startsAt.trim().length > 0 &&
    (isOnline || (venue.trim().length > 0 && city.trim().length > 0));

  function onCreate() {
    const nairaNum = Number(priceNaira.replace(/[^0-9.]/g, '')) || 0;
    const priceKobo = Math.round(nairaNum * 100);
    const input: CreateEventInput = {
      title: title.trim(),
      description: description.trim(),
      startsAt: startsAt.trim(),
      venue: isOnline ? 'Online' : venue.trim(),
      city: isOnline ? 'Online' : city.trim(),
      isOnline,
      priceKobo,
    };
    create.mutate(input, {
      onSuccess: (created) => {
        router.replace(`/connect/networking/event-detail?id=${encodeURIComponent(created.id)}`);
      },
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="New event" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInputField
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Fintech Founders Mixer"
          maxLength={80}
        />
        <TextInputField
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="What's happening at this event?"
          multiline
          numberOfLines={4}
          maxLength={500}
          style={styles.multiline}
        />
        <TextInputField
          label="Starts at"
          value={startsAt}
          onChangeText={setStartsAt}
          placeholder="YYYY-MM-DD HH:mm"
        />

        <View style={styles.toggleWrap}>
          <ToggleRow
            label="Online event"
            sub="No physical venue — attendees join remotely"
            value={isOnline}
            onValueChange={setIsOnline}
          />
        </View>

        <TextInputField
          label="Venue"
          value={isOnline ? '' : venue}
          onChangeText={setVenue}
          placeholder={isOnline ? 'Not needed for online events' : 'e.g. The Zone, Gbagada'}
          editable={!isOnline}
        />
        <TextInputField
          label="City"
          value={isOnline ? '' : city}
          onChangeText={setCity}
          placeholder={isOnline ? 'Not needed for online events' : 'e.g. Lagos'}
          editable={!isOnline}
        />

        <TextInputField
          label="Price (₦)"
          value={priceNaira}
          onChangeText={setPriceNaira}
          placeholder="0 for free"
          keyboardType="numeric"
        />

        {create.isError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Couldn't create the event. Please try again.</Text>
          </View>
        ) : null}

        <View style={{ height: Spacing.lg }} />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label="Create event"
          onPress={onCreate}
          loading={create.isPending}
          disabled={!canSubmit}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  toggleWrap: { marginBottom: Spacing.md },
  errorBox: {
    backgroundColor: Colors.errorContainer,
    borderRadius: 12,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  errorText: { ...Typography.labelMd, color: Colors.error },
  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
});
