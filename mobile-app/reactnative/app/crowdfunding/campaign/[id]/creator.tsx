import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { MapPin, CalendarDays, Briefcase } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import VerificationBadge from '@/features/crowdfunding/components/VerificationBadge';
import { useCampaign } from '@/features/crowdfunding/hooks/useCrowdfunding';
import { formatNairaCompact } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function CreatorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, isLoading, isError, refetch } = useCampaign(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Campaign creator" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !c ? (
        <StateView kind="error" title="Couldn't load profile" actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.avatar}><Text style={styles.initial}>{c.creator.name.charAt(0)}</Text></View>
            <Text style={styles.name}>{c.creator.name}</Text>
            <Text style={styles.type}>{c.creator.type[0] + c.creator.type.slice(1).toLowerCase()}</Text>
            <View style={styles.badgeWrap}><VerificationBadge level={c.creator.verification} /></View>
          </View>

          <View style={styles.statsCard}>
            <Stat value={String(c.creator.campaignsCreated)} label="Campaigns" />
            <View style={styles.divider} />
            <Stat value={formatNairaCompact(c.creator.totalRaisedKobo)} label="Raised" />
            <View style={styles.divider} />
            <Stat value={new Date(c.creator.joinedAt).getFullYear().toString()} label="Joined" />
          </View>

          {c.creator.bio ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.bio}>{c.creator.bio}</Text>
            </View>
          ) : null}

          <View style={styles.metaRow}>
            {c.creator.location ? <Meta icon={<MapPin size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />} text={c.creator.location} /> : null}
            <Meta icon={<CalendarDays size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />} text={`Member since ${new Date(c.creator.joinedAt).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' })}`} />
            <Meta icon={<Briefcase size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />} text={`${c.creator.campaignsCreated} campaign${c.creator.campaignsCreated === 1 ? '' : 's'} created`} />
          </View>

          <PrimaryButton label={c.creator.followed ? 'Following' : 'Follow creator'} variant="secondary" onPress={() => {}} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (<View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>);
}
function Meta({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (<View style={styles.meta}>{icon}<Text style={styles.metaText}>{text}</Text></View>);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.lg },
  header: { alignItems: 'center', gap: 6, paddingTop: Spacing.md },
  avatar: { width: 80, height: 80, borderRadius: Radius.full, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  initial: { ...Typography.headlineMd, color: Colors.primary },
  name: { ...Typography.headlineMd, color: Colors.onSurface },
  type: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  badgeWrap: { marginTop: 4 },
  statsCard: { flexDirection: 'row', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.md },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  divider: { width: 1, backgroundColor: Colors.surfaceContainerHigh },
  section: { gap: 6 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  bio: { ...Typography.bodyMd, color: Colors.onSurface },
  metaRow: { gap: Spacing.sm },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  metaText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
});
