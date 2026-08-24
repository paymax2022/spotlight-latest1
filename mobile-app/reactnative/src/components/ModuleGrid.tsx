import React from 'react';
import { View, StyleSheet, Linking } from 'react-native';
import ModuleCard from './ModuleCard';
import { ServiceModule } from '@/constants/modules';
import { Spacing } from '@/constants/spacing';
import { router } from 'expo-router';

interface Props {
  modules: ServiceModule[];
  columns?: number;
}

export default function ModuleGrid({ modules, columns = 4 }: Props) {
  const rows: ServiceModule[][] = [];
  for (let i = 0; i < modules.length; i += columns) {
    rows.push(modules.slice(i, i + columns));
  }

  return (
    <View style={styles.grid}>
      {rows.map((row, ri) => (
        <View key={ri} style={styles.row}>
          {row.map((mod) => (
            <View key={mod.id} style={[styles.cell, { width: `${100 / columns}%` }]}>
              <ModuleCard
                label={mod.label}
                icon={mod.icon}
                iconColor={mod.iconColor}
                bgColor={mod.bgColor}
                badge={mod.badge}
                comingSoon={mod.comingSoon}
                onPress={() => {
                  if (mod.comingSoon) return;
                  // A module whose experience only exists on the web carries an
                  // absolute URL instead of an app route. Opening it externally
                  // keeps one implementation of flows that involve payment,
                  // rather than a native copy that has to be kept in step.
                  if (/^https?:\/\//.test(mod.route)) {
                    void Linking.openURL(mod.route);
                    return;
                  }
                  router.push(mod.route as never);
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
  cell: {
    alignItems: 'center',
  },
});
