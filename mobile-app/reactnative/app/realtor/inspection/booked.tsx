import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarCheck, Building2, Video, Clock, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useInspection } from '@/features/realtor/hooks/useRealtor';
import { formatSlotDate } from '@/features/realtor/utils/realtorFormatters';

export default function InspectionBookedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const inspection = useInspection(String(id));

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.iconBox}>
          <CalendarCheck size={40} color={Colors.tertiaryContainer} strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>Inspection requested</Text>
        <Text style={styles.subtitle}>
          The agent will confirm your viewing shortly. You'll get a reminder before the date.
        </Text>

        {inspection.isLoading ? (
          <StateView kind="loading" compact />
        ) : inspection.data ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle} numberOfLines={2}>{inspection.data.listingTitle}</Text>
            <Row icon={<Clock size={16} color={Colors.secondary} strokeWidth={2} />} text={`${formatSlotDate(inspection.data.date)} at ${inspection.data.time}`} />
            <Row
              icon={inspection.data.viewingMode === 'physical'
                ? <Building2 size={16} color={Colors.secondary} strokeWidth={2} />
                : <Video size={16} color={Colors.secondary} strokeWidth={2} />}
              text={inspection.data.viewingMode === 'physical' ? 'In-person viewing' : 'Virtual tour'}
            />
            <Row icon={<MapPin size={16} color={Colors.secondary} strokeWidth={2} />} text={inspection.data.address} />
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="View inspection" onPress={() => router.replace(`/realtor/inspection/${id}`)} />
        <PrimaryButton label="Back to marketplace" variant="secondary" onPress={() => router.replace('/realtor')} />
      </View>
    </SafeAreaView>
  );
}

function Row({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.row}>
      {icon}
      <Text style={styles.rowText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 88, height: 88, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: {
    alignSelf: 'stretch',
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.md },
});
