import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { FlaskConical, ChevronRight, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView, StatusBadge } from '@/features/doctor/components';
import { usePetLabInbox } from '@/features/doctor/hooks';
import { PET_SPECIES_LABELS } from '@/features/doctor/constants';

// Pet lab result inbox (U.7) — list of pet lab results with abnormal (U.9) and
// interpreted markers; each row opens the result detail.
export default function PetLabInboxScreen() {
  const { data: inbox = [], isLoading, isError, refetch, isPlaceholderData } = usePetLabInbox();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Lab Result Inbox" />

      {isLoading && isPlaceholderData ? (
        <StateView variant="loading" label="Loading results" />
      ) : isError ? (
        <StateView variant="error" message="We could not load the lab inbox." onRetry={() => refetch()} />
      ) : inbox.length === 0 ? (
        <StateView variant="empty" icon={FlaskConical} title="No results" message="New pet lab results will appear here." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.list}>
            {inbox.map((item) => (
              <Pressable
                key={item.result.id}
                style={styles.row}
                onPress={() => router.push(`/(doctor)/vet/lab-result/${item.result.orderId}`)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.result.ref} result`}
              >
                <View style={[styles.icon, item.hasAbnormal && styles.iconAbnormal]}>
                  {item.hasAbnormal
                    ? <AlertTriangle size={18} color={Colors.error} strokeWidth={2.2} />
                    : <FlaskConical size={18} color={Colors.teal} strokeWidth={2} />}
                </View>
                <View style={styles.body}>
                  <Text style={styles.name} numberOfLines={1}>{item.result.petName}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{item.result.ref} - {PET_SPECIES_LABELS[item.result.petSpecies]} - {item.result.labName}</Text>
                  <Text style={styles.date}>{new Date(item.result.reportedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                </View>
                <View style={styles.right}>
                  {item.hasAbnormal && <StatusBadge label="Abnormal" tone="danger" />}
                  {!item.interpreted && <StatusBadge label="New" tone="info" />}
                  {item.interpreted && <StatusBadge label="Interpreted" tone="success" />}
                  <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: Colors.background },
  content:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  list:         { gap: Spacing.sm },
  row:          { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  icon:         { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgTeal },
  iconAbnormal: { backgroundColor: Colors.errorContainer },
  body:         { flex: 1, gap: 2 },
  name:         { ...Typography.labelLg, color: Colors.onSurface },
  meta:         { ...Typography.caption, color: Colors.onSurfaceVariant },
  date:         { ...Typography.caption, color: Colors.onSurfaceVariant },
  right:        { alignItems: 'flex-end', gap: 4 },
});
