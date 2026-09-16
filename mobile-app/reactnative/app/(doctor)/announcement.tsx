import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Megaphone } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, InfoRow } from '@/features/doctor/components';
import { useAnnouncement, useDismissAnnouncement } from '@/features/doctor/hooks';

export default function AnnouncementScreen() {
  const { data: announcement, isLoading, isError, refetch } = useAnnouncement();
  const dismiss = useDismissAnnouncement();

  const handleDismiss = async () => {
    if (!announcement) return;
    try {
      await dismiss.mutateAsync({ announcementId: announcement.id });
      goBack('/');
    } catch { /* surfaced */ }
  };

  if (isLoading && !announcement) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Announcement" />
        <StateView variant="loading" label="Loading announcement" />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Announcement" />
        <StateView variant="error" message="We could not load this announcement." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  if (!announcement) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Announcement" />
        <StateView variant="empty" icon={Megaphone} title="No announcements" message="There are no platform announcements right now." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Announcement" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Megaphone size={28} color={Colors.primary} strokeWidth={2} />
          </View>
          <Text style={styles.title}>{announcement.title}</Text>
        </View>

        <SectionCard style={styles.card}>
          <Text style={styles.body}>{announcement.body}</Text>
        </SectionCard>

        <SectionCard title="Details" style={styles.card}>
          <InfoRow label="Published" value={new Date(announcement.publishedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />
        </SectionCard>

        {announcement.dismissible && (
          <PrimaryButton label="Dismiss" onPress={handleDismiss} loading={dismiss.isPending} variant="secondary" style={styles.btn} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: Colors.background },
  content:  { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  hero:     { alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg },
  heroIcon: { width: 64, height: 64, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title:    { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  card:     { marginBottom: Spacing.md },
  body:     { ...Typography.bodyMd, color: Colors.onSurface },
  btn:      { marginTop: Spacing.sm },
});
