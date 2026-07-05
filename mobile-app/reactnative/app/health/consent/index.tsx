import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConsentToggleRow } from '@/features/health/components';
import { useConsents, useRevokeConsent } from '@/features/health/hooks';
import { NDPA_CONSENT_COPY } from '@/features/health/constants/health.constants';

export default function ConsentManagerScreen() {
  const { data: consents, isLoading, isError, refetch, isRefetching } = useConsents();
  const revoke = useRevokeConsent();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const onRevoke = (id: string) => {
    Alert.alert('Revoke access?', 'This provider will immediately lose access to the shared data.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: () => {
          setRevokingId(id);
          revoke.mutate(id, { onSettled: () => setRevokingId(null) });
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Consent & sharing"
        subtitle="Granular, revocable access"
        rightSlot={
          <Pressable onPress={() => router.push('/health/consent/grant')} hitSlop={8} accessibilityLabel="Grant new access">
            <Plus size={22} color={Colors.primary} strokeWidth={2.2} />
          </Pressable>
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading consent grants…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load grants" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={consents ?? []}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <ConsentToggleRow grant={item} onRevoke={onRevoke} revoking={revokingId === item.id} />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListHeaderComponent={
            <View style={styles.ndpa}>
              <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
              <Text style={styles.ndpaText}>{NDPA_CONSENT_COPY}</Text>
            </View>
          }
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="ShieldCheck"
              title="No active grants"
              message="You haven't shared any health data yet. Grant access to a provider when you're ready."
              actionLabel="Grant access"
              onAction={() => router.push('/health/consent/grant')}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 100, flexGrow: 1 },
  ndpa: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.xs,
  },
  ndpaText: { ...Typography.caption, color: Colors.tertiaryContainer, flex: 1, lineHeight: 16 },
});
