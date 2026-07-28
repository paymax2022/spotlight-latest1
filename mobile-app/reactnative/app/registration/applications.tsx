import React from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import StatusChip from '@/features/registration/components/StatusChip';
import { useMyApplications } from '@/features/registration/hooks/useRegistration';
import { isLockedForEditing } from '@/features/registration/utils/status';
import type { RegistrationDraft } from '@/features/registration/types/registration.types';

export default function MyApplicationsScreen() {
  const apps = useMyApplications();

  const openApp = (draft: RegistrationDraft) => {
    if (isLockedForEditing(draft.status)) {
      router.push(`/registration/${draft.id}/status` as never);
    } else {
      router.push(`/registration/${draft.id}/wizard` as never);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="My applications"
        rightSlot={
          <Pressable onPress={() => router.push('/registration' as never)} hitSlop={10} accessibilityLabel="New application">
            <Plus size={22} color={Colors.onSurface} />
          </Pressable>
        }
      />

      {apps.isLoading ? (
        <StateView kind="loading" message="Loading your applications…" />
      ) : apps.isError ? (
        <StateView kind="error" title="Couldn’t load applications" actionLabel="Retry" onAction={() => apps.refetch()} />
      ) : (apps.data ?? []).length === 0 ? (
        <StateView
          kind="empty"
          icon="ClipboardList"
          title="No applications yet"
          message="You haven’t applied to any contest. Start one to enter the spotlight."
          actionLabel="Browse contests"
          onAction={() => router.push('/registration' as never)}
        />
      ) : (
        <FlatList
          data={apps.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={apps.isRefetching} onRefresh={apps.refetch} tintColor={Colors.primary} />}
          renderItem={({ item }) => (
            <Pressable style={[styles.card, shadow1]} onPress={() => openApp(item)}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {String(item.formData['contest.title'] || item.contestSlug)}
                </Text>
                <Text style={styles.cardRef}>{item.reference}</Text>
                <StatusChip status={item.status} />
                {item.status === 'draft' && (
                  <Text style={styles.progress}>{item.completionPercent}% complete · tap to continue</Text>
                )}
              </View>
              <ChevronRight size={20} color={Colors.onSurfaceVariant} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardRef: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  progress: { ...Typography.labelSm, color: Colors.primary, marginTop: 2 },
});
