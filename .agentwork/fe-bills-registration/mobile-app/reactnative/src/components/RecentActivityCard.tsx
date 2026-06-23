import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import * as Icons from 'lucide-react-native';

export interface Activity {
  id:        string;
  title:     string;
  subtitle:  string;
  amount:    number;
  type:      'credit' | 'debit';
  icon:      string;
  iconColor: string;
  bgColor:   string;
  date:      string;
}

interface Props {
  activity: Activity;
}

export default function RecentActivityCard({ activity }: Props) {
  const IconComponent = (Icons as unknown as Record<string, Icons.LucideIcon>)[activity.icon] ?? Icons.Circle;
  const isCredit = activity.type === 'credit';

  return (
    <View style={styles.card}>
      <View style={[styles.iconBox, { backgroundColor: activity.bgColor }]}>
        <IconComponent size={20} color={activity.iconColor} strokeWidth={1.8} />
      </View>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>{activity.title}</Text>
        <Text style={styles.sub}>{activity.subtitle}</Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, isCredit ? styles.credit : styles.debit]}>
          {isCredit ? '+' : '-'}₦{Math.abs(activity.amount).toLocaleString('en-NG')}
        </Text>
        <Text style={styles.date}>{activity.date}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingVertical: Spacing.sm,
    gap:             Spacing.sm,
  },
  iconBox: {
    width:          44,
    height:         44,
    borderRadius:   Radius.md,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  info: {
    flex: 1,
  },
  title: {
    ...Typography.labelMd,
    color: Colors.onSurface,
  },
  sub: {
    ...Typography.labelSm,
    color:     Colors.onSurfaceVariant,
    marginTop: 2,
  },
  right: {
    alignItems: 'flex-end',
  },
  amount: {
    ...Typography.labelMd,
    fontWeight: '700',
  },
  credit: {
    color: Colors.teal,
  },
  debit: {
    color: Colors.onSurface,
  },
  date: {
    ...Typography.caption,
    color:     Colors.outline,
    marginTop: 2,
  },
});
