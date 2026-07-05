import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FileText, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useLegalDocs } from '@/features/connect/hooks/useConnect';

// ST-15 — Legal. Terms, privacy (NDPA), community guidelines.
export default function Legal() {
  const { data, isLoading, error, refetch } = useLegalDocs();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Legal" />
      {isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : error || !data ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <View style={styles.card}>
            {data.map((d, i, arr) => (
              <Pressable
                key={d.id}
                style={[styles.row, i < arr.length - 1 && styles.divider]}
                onPress={() => Linking.openURL(d.url).catch(() => {})}
                accessibilityRole="link"
                accessibilityLabel={d.title}
              >
                <View style={styles.icon}><FileText size={18} color={Colors.primary} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{d.title}</Text>
                  <Text style={styles.meta}>Updated {d.updatedAt}</Text>
                </View>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            ))}
          </View>
          <Text style={styles.note}>Paymax Connect · v1.0.0</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, paddingTop: Spacing.lg },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  divider: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  icon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  note: { ...Typography.caption, color: Colors.outline, textAlign: 'center', marginTop: Spacing.lg },
});
