import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import ProfileMenuItem from '@/components/ProfileMenuItem';
import { useApprovals } from '@/features/fx/hooks/useFxAccount';

export default function BusinessHubScreen() {
  const approvals = useApprovals();
  const pending = (approvals.data ?? []).filter((a) => a.status === 'PENDING').length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Business" subtitle="Team, approvals & developer tools" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.section}>Team & controls</Text>
        <View style={styles.group}>
          <ProfileMenuItem icon="Users" label="Team members" onPress={() => router.push('/fx/business/team')} />
          <Divider />
          <ProfileMenuItem icon="CheckCheck" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Approval queue" value={pending ? `${pending} pending` : undefined} onPress={() => router.push('/fx/business/approvals')} />
          <Divider />
          <ProfileMenuItem icon="SlidersHorizontal" iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="Approval thresholds" onPress={() => router.push('/fx/business/thresholds')} />
          <Divider />
          <ProfileMenuItem icon="ScrollText" label="Activity log" onPress={() => router.push('/fx/business/activity')} />
        </View>

        <Text style={styles.section}>Developer</Text>
        <View style={styles.group}>
          <ProfileMenuItem icon="KeyRound" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="API keys & webhooks" onPress={() => router.push('/fx/business/developer')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Divider() { return <View style={styles.divider} />; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.lg, marginBottom: Spacing.sm, paddingHorizontal: Spacing.containerMargin },
  group: { marginHorizontal: Spacing.containerMargin, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow, marginLeft: Spacing.containerMargin + 40 + Spacing.md },
});
