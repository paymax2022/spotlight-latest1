// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  iconWrap: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { fontSize: 22, fontWeight: '800', color: colors.neutral.text, textAlign: 'center' },
  sub: { fontSize: 15, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 22 },
  btn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center', minWidth: 160 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  ghostBtn: { height: 52, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { fontSize: 15, fontWeight: '700', color: colors.neutral.textMuted },
});

export function NoInternet({ onRetry }: { onRetry?: () => void }) {
  return (
    <SafeAreaView style={S.safe}>
      <View style={S.wrap}>
        <View style={[S.iconWrap, { backgroundColor: colors.neutral.surfaceAlt }]}>
          <Ionicons name="wifi-outline" size={52} color={colors.neutral.placeholder} />
        </View>
        <Text style={S.title}>No Internet Connection</Text>
        <Text style={S.sub}>Check your connection and try again.</Text>
        <Pressable style={S.btn} onPress={onRetry}>
          <Text style={S.btnText}>Retry</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export function ServerError({ onRetry, errorCode }: { onRetry?: () => void; errorCode?: string }) {
  return (
    <SafeAreaView style={S.safe}>
      <View style={S.wrap}>
        <View style={[S.iconWrap, { backgroundColor: colors.secondary.red + '15' }]}>
          <Ionicons name="cloud-offline" size={52} color={colors.secondary.red} />
        </View>
        <Text style={S.title}>Something Went Wrong</Text>
        {errorCode && <Text style={[S.sub, { fontSize: 12, color: colors.neutral.placeholder }]}>Error: {errorCode}</Text>}
        <Text style={S.sub}>We are working to fix this. Please try again.</Text>
        <Pressable style={S.btn} onPress={onRetry}>
          <Text style={S.btnText}>Try Again</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export function MaintenanceMode() {
  return (
    <SafeAreaView style={S.safe}>
      <View style={S.wrap}>
        <View style={[S.iconWrap, { backgroundColor: colors.secondary.amber + '15' }]}>
          <Ionicons name="construct" size={52} color={colors.secondary.amber} />
        </View>
        <Text style={S.title}>System Maintenance</Text>
        <Text style={S.sub}>We are performing scheduled maintenance. We will be back shortly.</Text>
        <View style={StyleSheet.flatten([S.btn, { backgroundColor: colors.secondary.amber + '20' }])}>
          <Text style={[S.btnText, { color: colors.secondary.amber }]}>Estimated: 2–4 hours</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

export function AppUpdateRequired() {
  return (
    <SafeAreaView style={S.safe}>
      <View style={S.wrap}>
        <View style={[S.iconWrap, { backgroundColor: colors.secondary.DEFAULT + '15' }]}>
          <Ionicons name="download" size={52} color={colors.secondary.DEFAULT} />
        </View>
        <Text style={S.title}>Update Available</Text>
        <Text style={S.sub}>A new version of Paymax is required to continue.</Text>
        <Pressable style={S.btn} onPress={() => Linking.openURL('https://apps.apple.com')}>
          <Text style={S.btnText}>Update Now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export function SessionExpired() {
  const router = useRouter();
  return (
    <SafeAreaView style={S.safe}>
      <View style={S.wrap}>
        <View style={[S.iconWrap, { backgroundColor: colors.primary.DEFAULT + '15' }]}>
          <Ionicons name="lock-closed" size={52} color={colors.primary.DEFAULT} />
        </View>
        <Text style={S.title}>Session Expired</Text>
        <Text style={S.sub}>For your security, you were signed out. Please sign in again.</Text>
        <Pressable style={S.btn} onPress={() => router.replace('/(auth)/login' as never)}>
          <Text style={S.btnText}>Sign In Again</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export function AccessDenied({ reason }: { reason?: string }) {
  const router = useRouter();
  return (
    <SafeAreaView style={S.safe}>
      <View style={S.wrap}>
        <View style={[S.iconWrap, { backgroundColor: colors.secondary.red + '15' }]}>
          <Ionicons name="ban" size={52} color={colors.secondary.red} />
        </View>
        <Text style={S.title}>Access Denied</Text>
        <Text style={S.sub}>{reason || 'You do not have permission to access this resource.'}</Text>
        <Pressable style={S.btn} onPress={() => router.back()}>
          <Text style={S.btnText}>Go Back</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export function EmptyState({ icon, title, subtitle, actionLabel, onAction }: {
  icon: string; title: string; subtitle?: string; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <View style={emptyStyles.wrap}>
      <Ionicons name={icon as any} size={60} color={colors.neutral.placeholder} />
      <Text style={emptyStyles.title}>{title}</Text>
      {subtitle && <Text style={emptyStyles.sub}>{subtitle}</Text>}
      {actionLabel && onAction && (
        <Pressable style={S.btn} onPress={onAction}>
          <Text style={S.btnText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}
const emptyStyles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  title: { fontSize: 18, fontWeight: '700', color: colors.neutral.text, textAlign: 'center' },
  sub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 20 },
});

export function PermissionDenied({ permission }: { permission: string }) {
  const router = useRouter();
  return (
    <SafeAreaView style={S.safe}>
      <View style={S.wrap}>
        <View style={[S.iconWrap, { backgroundColor: colors.secondary.amber + '15' }]}>
          <Ionicons name="shield-outline" size={52} color={colors.secondary.amber} />
        </View>
        <Text style={S.title}>Permission Required</Text>
        <Text style={S.sub}>This feature requires {permission} permission. Please grant it in your device settings.</Text>
        <Pressable style={S.btn}>
          <Text style={S.btnText}>Open Settings</Text>
        </Pressable>
        <Pressable style={S.ghostBtn} onPress={() => router.back()}>
          <Text style={S.ghostBtnText}>Not Now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export function PaymentFailed({ onRetry, onSupport }: { onRetry?: () => void; onSupport?: () => void }) {
  return (
    <SafeAreaView style={S.safe}>
      <View style={S.wrap}>
        <View style={[S.iconWrap, { backgroundColor: colors.secondary.red + '15' }]}>
          <Ionicons name="close-circle" size={52} color={colors.secondary.red} />
        </View>
        <Text style={S.title}>Payment Failed</Text>
        <Text style={S.sub}>Your payment could not be processed. Please check your card details and try again.</Text>
        <Pressable style={S.btn} onPress={onRetry}>
          <Text style={S.btnText}>Try Again</Text>
        </Pressable>
        <Pressable style={S.ghostBtn} onPress={onSupport}>
          <Text style={S.ghostBtnText}>Contact Support</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export function QRExpired({ onCreateNew }: { onCreateNew?: () => void }) {
  return (
    <SafeAreaView style={S.safe}>
      <View style={S.wrap}>
        <View style={[S.iconWrap, { backgroundColor: colors.secondary.amber + '15' }]}>
          <Ionicons name="qr-code-outline" size={52} color={colors.secondary.amber} />
        </View>
        <Text style={S.title}>Code Expired</Text>
        <Text style={S.sub}>This visitor code has expired and can no longer be used.</Text>
        <Pressable style={S.btn} onPress={onCreateNew}>
          <Text style={S.btnText}>Create New Code</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export function InvalidCode({ onTryAgain }: { onTryAgain?: () => void }) {
  return (
    <SafeAreaView style={S.safe}>
      <View style={S.wrap}>
        <View style={[S.iconWrap, { backgroundColor: colors.secondary.red + '15' }]}>
          <Ionicons name="alert-circle" size={52} color={colors.secondary.red} />
        </View>
        <Text style={S.title}>Invalid Code</Text>
        <Text style={S.sub}>This code is invalid or has already been used. Please check and try again.</Text>
        <Pressable style={S.btn} onPress={onTryAgain}>
          <Text style={S.btnText}>Try Again</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export function AlreadyVoted() {
  const router = useRouter();
  return (
    <SafeAreaView style={S.safe}>
      <View style={S.wrap}>
        <View style={[S.iconWrap, { backgroundColor: colors.secondary.emerald + '15' }]}>
          <Ionicons name="checkmark-done-circle" size={52} color={colors.secondary.emerald} />
        </View>
        <Text style={S.title}>Already Voted</Text>
        <Text style={S.sub}>You have already cast your vote in this election. Each resident can vote only once.</Text>
        <Pressable style={S.btn} onPress={() => router.back()}>
          <Text style={S.btnText}>Go Back</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export function SubscriptionExpired({ onRenew }: { onRenew?: () => void }) {
  return (
    <SafeAreaView style={S.safe}>
      <View style={S.wrap}>
        <View style={[S.iconWrap, { backgroundColor: colors.secondary.red + '15' }]}>
          <Ionicons name="card-outline" size={52} color={colors.secondary.red} />
        </View>
        <Text style={S.title}>Subscription Expired</Text>
        <Text style={S.sub}>Your estate subscription has expired. Renew to restore full access.</Text>
        <Pressable style={S.btn} onPress={onRenew}>
          <Text style={S.btnText}>Renew Now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
