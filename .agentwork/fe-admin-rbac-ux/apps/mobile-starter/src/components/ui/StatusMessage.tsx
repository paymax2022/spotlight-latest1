import { AppText } from '@/components/ui/AppText';
import { colors } from '@/theme';

export function StatusMessage({ error, success }: { error?: string | null; success?: string | null }) {
  if (!error && !success) return null;
  return (
    <AppText variant="caption" color={error ? colors.secondary.red : colors.secondary.emerald}>
      {error || success}
    </AppText>
  );
}
