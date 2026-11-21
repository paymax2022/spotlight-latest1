import React from 'react';
import { View, StyleSheet } from 'react-native';
import ModuleCard from './ModuleCard';
import { ServiceModule } from '@/constants/modules';
import { Spacing } from '@/constants/tokens';
import { router } from 'expo-router';

interface Props {
  modules: ServiceModule[];
  columns?: number;
  /** Smaller tiles with the prototype's 15px row pitch. See ModuleCard.compact. */
  compact?: boolean;
}

export default function ModuleGrid({ modules, columns = 4, compact }: Props) {
  const rows: ServiceModule[][] = [];
  for (let i = 0; i < modules.length; i += columns) {
    rows.push(modules.slice(i, i + columns));
  }

  return (
    <View style={styles.grid}>
      {rows.map((row, ri) => (
        <View key={ri} style={[styles.row, compact && styles.rowCompact]}>
          {row.map((mod) => (
            <View key={mod.id} style={[styles.cell, { width: `${100 / columns}%` }]}>
              <ModuleCard
                label={mod.label}
                icon={mod.icon}
                iconColor={mod.iconColor}
                bgColor={mod.bgColor}
                badge={mod.badge}
                comingSoon={mod.comingSoon}
                compact={compact}
                onPress={() => {
                  if (!mod.comingSoon) {
                    router.push(mod.route as never);
                  }
                }}
              />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    paddingHorizontal: Spacing.containerMargin,
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    marginBottom:  Spacing.sm,
  },
  // With the grid's 8px gap this makes the prototype's 15px between rows.
  rowCompact: {
    marginBottom: 7,
  },
  cell: {
    alignItems: 'center',
  },
});
