import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import TextInputField from '@/components/TextInputField';
import DiscoveryChipRow from '@/features/connect/components/discovery-ChipRow';
import { useUnifiedProfile, useUpdateModeProfile } from '@/features/connect/profile/hooks';
import type { ConnectMode, EditProfileInput } from '@/features/connect/profile/types';

// PR — Edit one mode's profile. Mode-scoped so date copy never leaks into the
// network profile (and vice-versa).
const DATE_INTENTS = ['Long-term', 'Casual', 'New friends', 'Not sure'];
const NETWORK_INTENTS = ['Mentoring', 'Hiring', 'Co-founders', 'Collaborating'];
const INTEREST_OPTIONS = [
  'Design', 'Tech', 'Music', 'Travel', 'Fitness',
  'Food', 'Art', 'Startups', 'Wellness', 'Sports',
];

export default function ProfileEdit() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode: ConnectMode = params.mode === 'network' ? 'network' : 'date';
  const { data, isLoading, error, refetch } = useUnifiedProfile();
  const update = useUpdateModeProfile();

  const source = mode === 'date' ? data?.dateProfile : data?.networkProfile;
  const intentOptions = mode === 'date' ? DATE_INTENTS : NETWORK_INTENTS;

  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [intent, setIntent] = useState('');
  const [interests, setInterests] = useState<string[]>([]);

  // Seed from the loaded profile once available (and re-seed if mode changes).
  useEffect(() => {
    if (source) {
      setHeadline(source.headline);
      setBio(source.bio);
      setIntent(source.intent || intentOptions[0]);
      setInterests(source.interests);
    }
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleInterest = (value: string) => {
    setInterests((prev) =>
      prev.includes(value) ? prev.filter((i) => i !== value) : [...prev, value],
    );
  };

  const onSave = () => {
    const payload: EditProfileInput = { mode, headline, bio, intent, interests };
    update.mutate(payload, { onSuccess: () => router.back() });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Edit profile"
        subtitle={mode === 'date' ? 'Date profile' : 'Network profile'}
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading profile…" />
      ) : error || !data || !source ? (
        <StateView
          kind="error"
          title="Couldn't load profile"
          icon="UserX"
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            <TextInputField
              label="Headline"
              value={headline}
              onChangeText={setHeadline}
              placeholder={
                mode === 'date' ? 'A line that sums you up' : 'Role · focus area'
              }
            />

            <TextInputField
              label="Bio"
              value={bio}
              onChangeText={setBio}
              placeholder={
                mode === 'date'
                  ? 'Share what you love and who you want to meet'
                  : 'What you do and what you can help with'
              }
              multiline
              numberOfLines={5}
              style={styles.bioInput}
            />

            <Text style={styles.label}>{mode === 'date' ? 'Looking for' : 'Here to'}</Text>
            <View style={styles.segmentWrap}>
              <SegmentedControl
                scrollable
                options={intentOptions.map((v) => ({ value: v, label: v }))}
                value={intent}
                onChange={setIntent}
              />
            </View>

            <Text style={[styles.label, styles.labelSpaced]}>
              {mode === 'date' ? 'Interests' : 'Skills & interests'}
            </Text>
            <DiscoveryChipRow
              items={INTEREST_OPTIONS}
              selected={interests}
              onToggle={toggleInterest}
              variant="selectable"
            />
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label="Save changes"
              onPress={onSave}
              loading={update.isPending}
              disabled={headline.trim().length === 0}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 40 },
  bioInput: { minHeight: 110, textAlignVertical: 'top' },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  labelSpaced: { marginTop: Spacing.lg },
  segmentWrap: { marginHorizontal: -Spacing.containerMargin },
  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.background,
  },
});
