import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Video, Phone, MessageCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { ConsultType } from '@/types/telemedicine';

const OPTIONS: { value: ConsultType; label: string; Icon: typeof Video }[] = [
  { value: 'video', label: 'Video', Icon: Video },
  { value: 'audio', label: 'Audio', Icon: Phone },
  { value: 'chat',  label: 'Chat',  Icon: MessageCircle },
];

interface Props {
  selected: ConsultType;
  onSelect: (value: ConsultType) => void;
}

export default function ConsultTypePicker({ selected, onSelect }: Props) {
  return (
    <View style={styles.row}>
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = selected === value;
        return (
          <Pressable key={value} onPress={() => onSelect(value)} style={[styles.opt, active && styles.optActive]}>
            <Icon size={20} color={active ? Colors.onPrimary : Colors.primary} strokeWidth={2} />
            <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row:         { flexDirection: 'row', gap: Spacing.sm },
  opt:         { flex: 1, height: 76, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  optActive:   { backgroundColor: Colors.primary, borderColor: Colors.primary },
  label:       { ...Typography.labelMd, color: Colors.onSurface },
  labelActive: { color: Colors.onPrimary },
});
