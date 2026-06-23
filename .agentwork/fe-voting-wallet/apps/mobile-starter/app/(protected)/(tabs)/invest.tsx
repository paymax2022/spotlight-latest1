// @ts-nocheck
import { AppCard } from '@/components/ui/AppCard';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';
import { colors } from '@/theme';

export default function InvestScreen() {
  return (
    <AppScreen>
      <AppText variant="h1">Invest</AppText>
      <AppCard>
        <AppText color={colors.neutral.textMuted}>Investment products will appear here when enabled by the backend.</AppText>
      </AppCard>
    </AppScreen>
  );
}
