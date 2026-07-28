import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { DisclosureCard } from '@/features/referral/components';
import { useTraining } from '@/features/referral/agent/hooks';

// M-AGT-06 — Team training / resources: compliant scripts, materials.
const TYPE_LABEL: Record<string, string> = {
  script: 'Script', guide: 'Guide', video: 'Video', policy: 'Policy',
};

export default function AgentTrainingScreen() {
  const { data, isLoading, isError, refetch } = useTraining();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Training & resources" />
      {isLoading ? (
        <StateView kind="loading" message="Loading resources…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <DisclosureCard
            tone="warn"
            title="Stay compliant"
            body="Never promise guaranteed income or pay people to sign up. Coach your team to drive real activity — that is the only thing that earns."
          />
          {data && data.length > 0 ? (
            data.map((r) => {
              const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[r.icon] ?? Icons.FileText;
              return (
                <Pressable key={r.id} style={styles.card} accessibilityRole="button">
                  <View style={[styles.icon, r.compliance && styles.iconCompliance]}>
                    <Icon size={20} color={r.compliance ? Colors.onWarning : Colors.primary} strokeWidth={2} />
                  </View>
                  <View style={styles.body}>
                    <View style={styles.titleRow}>
                      <Text style={styles.title} numberOfLines={1}>{r.title}</Text>
                      {r.compliance ? <View style={styles.compTag}><Text style={styles.compText}>Compliance</Text></View> : null}
                    </View>
                    <Text style={styles.blurb} numberOfLines={2}>{r.blurb}</Text>
                    <Text style={styles.type}>{TYPE_LABEL[r.type] ?? r.type}</Text>
                  </View>
                  <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
                </Pressable>
              );
            })
          ) : (
            <StateView kind="empty" icon="GraduationCap" title="No resources yet" message="Training materials appear here." compact />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  icon: { width: 42, height: 42, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  iconCompliance: { backgroundColor: Colors.iconBgGold },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  compTag: { backgroundColor: Colors.iconBgGold, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full },
  compText: { ...Typography.caption, color: Colors.onWarning, fontWeight: '700' as const },
  blurb: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  type: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
