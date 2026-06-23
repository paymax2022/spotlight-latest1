import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, radius, spacing } from '@/theme';

type Choice = {
  label: string;
  value: string;
  caption?: string;
};

export function ChoiceList({
  choices,
  value,
  onChange,
  emptyText = 'No options available.'
}: {
  choices: Choice[];
  value?: string;
  onChange: (value: string) => void;
  emptyText?: string;
}) {
  if (!choices.length) {
    return <AppText color={colors.neutral.textMuted}>{emptyText}</AppText>;
  }

  return (
    <View style={{ gap: spacing[2] }}>
      {choices.map((choice) => {
        const selected = choice.value === value;
        return (
          <Pressable
            key={choice.value}
            onPress={() => onChange(choice.value)}
            style={{
              borderWidth: 1,
              borderColor: selected ? colors.primary.blue : colors.neutral.border,
              backgroundColor: selected ? '#eff6ff' : colors.neutral.white,
              borderRadius: radius.md,
              padding: spacing[3],
              gap: 2
            }}
          >
            <AppText variant="bodyMedium">{choice.label}</AppText>
            {choice.caption ? (
              <AppText variant="caption" color={colors.neutral.textMuted}>
                {choice.caption}
              </AppText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
