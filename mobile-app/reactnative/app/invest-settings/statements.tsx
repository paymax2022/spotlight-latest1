import React, { useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import StatementRow from '@/features/investsettings/components/StatementRow';
import { useStatements, useExportStatement } from '@/features/investsettings/hooks/useSettings';

export default function StatementsScreen() {
  const { data, isLoading, isError, refetch } = useStatements();
  const exportStmt = useExportStatement();
  const [exportingId, setExportingId] = useState<string | null>(null);

  const onExport = (id: string) => {
    setExportingId(id);
    exportStmt.mutate(id, { onSettled: () => setExportingId(null) });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Statements" subtitle="Statements & tax documents" />

      {isLoading ? (
        <StateView kind="loading" message="Loading statements…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load statements" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (data ?? []).length === 0 ? (
        <StateView kind="empty" icon="FileText" title="No statements yet"
          message="Your monthly statements and tax documents will appear here." />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <StatementRow
              statement={item}
              exporting={exportingId === item.id}
              onExport={() => onExport(item.id)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
});
