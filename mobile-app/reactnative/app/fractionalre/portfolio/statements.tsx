import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FileText, Download } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useStatements } from '@/features/fractionalre/hooks';
import { relativeDate } from '@/features/fractionalre/utils';

export default function StatementsScreen() {
  const statements = useStatements();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Statements" />
      {statements.isLoading ? (
        <StateView kind="loading" message="Loading statements…" />
      ) : (statements.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="No statements yet" message="Quarterly and annual statements will appear here." icon="FileText" />
      ) : (
        <FlatList
          data={statements.data}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => Linking.openURL(item.url).catch(() => {})}>
              <View style={styles.iconBox}><FileText size={18} color={Colors.secondary} strokeWidth={2} /></View>
              <View style={styles.text}>
                <Text style={styles.title}>{item.label}</Text>
                <Text style={styles.sub}>{item.period} · issued {relativeDate(item.issuedAt)}</Text>
              </View>
              <Download size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
