// @ts-nocheck
import { useQuery } from '@tanstack/react-query';

import { getMe } from '@/api/auth.api';
import { AppButton } from '@/components/ui/AppButton';
import { AppCard } from '@/components/ui/AppCard';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';
import { colors } from '@/theme';
import { useAuthStore } from '@/store/authStore';

export default function MoreScreen() {
  const logout = useAuthStore((s) => s.logout);
  const user = useQuery({ queryKey: ['me'], queryFn: getMe });

  return (
    <AppScreen>
      <AppText variant="h1">Profile</AppText>
      <AppCard>
        <AppText variant="h2">{user.data?.fullName || 'Account'}</AppText>
        <AppText color={colors.neutral.textMuted}>{user.data?.email}</AppText>
        <AppText color={colors.neutral.textMuted}>{user.data?.phone}</AppText>
        {user.data?.kycStatus ? <AppText>KYC: {user.data.kycStatus}</AppText> : null}
      </AppCard>
      <AppButton title="Logout" variant="danger" onPress={logout} />
    </AppScreen>
  );
}
