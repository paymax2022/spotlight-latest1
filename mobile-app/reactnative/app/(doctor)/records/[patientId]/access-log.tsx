import React from 'react';
import { ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { ScrollText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, AccessLogRow } from '@/features/doctor/components';
import { usePatientRecordHub } from '@/features/doctor/hooks';

// W.17: medical record access log. Reuses usePatientRecordHub.accessLog and the
// AccessLogRow component (extracted from the previous hub screen).
export default function RecordAccessLogScreen() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const { data: hub, isLoading, isError, refetch } = usePatientRecordHub(String(patientId));
  const log = hub?.accessLog ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Access Log" />

      {isLoading && !hub ? (
        <StateView variant="loading" label="Loading access log" />
      ) : isError || !hub ? (
        <StateView variant="error" message="We could not load the access log." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {log.length === 0 ? (
            <StateView variant="empty" icon={ScrollText} title="No access recorded" message="Record access events will appear here." />
          ) : (
            <SectionCard title="Who accessed this record">
              {log.map((a, i) => (
                <AccessLogRow key={a.id} actor={a.actor} action={a.action} section={a.section} role={a.role} at={a.at} border={i > 0} />
              ))}
            </SectionCard>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, flexGrow: 1 },
});
