import React from 'react';
import { FlatList, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { FileText, Image as ImageIcon, BadgeCheck, Download } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useCampaign } from '@/features/crowdfunding/hooks/useCrowdfunding';

export default function DocumentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, isLoading, isError, refetch } = useCampaign(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Documents" subtitle="Supporting evidence for this campaign" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !c ? (
        <StateView kind="error" title="Couldn't load documents" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={c.documents}
          keyExtractor={(d) => d.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={`${item.label}, ${item.sizeLabel}`}>
              <View style={styles.iconBox}>
                {item.type === 'pdf' ? <FileText size={20} color={Colors.secondary} strokeWidth={2} /> : <ImageIcon size={20} color={Colors.secondary} strokeWidth={2} />}
              </View>
              <View style={styles.body}>
                <View style={styles.titleRow}>
                  <Text style={styles.label} numberOfLines={1}>{item.label}</Text>
                  {item.verified && <BadgeCheck size={15} color={Colors.tertiaryContainer} strokeWidth={2.2} />}
                </View>
                <Text style={styles.meta}>{item.type.toUpperCase()} · {item.sizeLabel}</Text>
              </View>
              <Download size={18} color={Colors.outline} strokeWidth={2} />
            </Pressable>
          )}
          ListEmptyComponent={
            <StateView kind="empty" icon="FolderOpen" title="No documents" message="The creator hasn't attached supporting documents." />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.sm, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
