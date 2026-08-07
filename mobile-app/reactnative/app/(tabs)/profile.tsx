import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  LogOut,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Store,
  ChevronRight,
  LineChart,
  KeyRound,
  Building2,
} from 'lucide-react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import TextInputField from '@/components/TextInputField';
import DatePickerField from '@/components/DatePickerField';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { useAuthStore } from '@/store/authStore';
import {
  claimTier0,
  getKyc,
  getProfile,
  KycDocumentType,
  KycTier,
  ProfileDetails,
  submitKyc,
  updateProfile,
} from '@/api/profile.api';
import { STATE_NAMES, getLGAsForState } from '@/data/nigeria';
import { getErrorMessage } from '@/utils/errorMapper';
import { confirmAsync, alertAsync } from '@/lib/confirm';

type ProfileForm = {
  firstName: string;
  lastName: string;
  displayName: string;
  phone: string;
  whatsapp: string;
  dateOfBirth: string;
  gender: string;
  state: string;
  lga: string;
  city: string;
  address: string;
};

const EMPTY_PROFILE_FORM: ProfileForm = {
  firstName: '',
  lastName: '',
  displayName: '',
  phone: '',
  whatsapp: '',
  dateOfBirth: '',
  gender: '',
  state: '',
  lga: '',
  city: '',
  address: '',
};

const TIER_OPTIONS: Array<{
  tier: KycTier;
  title: string;
  subtitle: string;
  requirement: string;
  what: string;
  limit: string;
  allowedDocs: KycDocumentType[];
}> = [
  {
    tier: 0,
    title: 'Tier 0',
    subtitle: 'Quick start',
    requirement: 'Email · Date of birth · Phone',
    what: 'Auto-verified — no document needed',
    limit: '₦10,000 / day',
    allowedDocs: [],
  },
  {
    tier: 1,
    title: 'Tier 1',
    subtitle: 'BVN verification',
    requirement: 'Submit your Bank Verification Number',
    what: 'BVN only — links your wallet to your bank identity',
    limit: '₦50,000 / day',
    allowedDocs: ['BVN'],
  },
  {
    tier: 2,
    title: 'Tier 2',
    subtitle: 'NIN verification',
    requirement: 'Submit your National Identification Number',
    what: 'NIN only — confirms your NIMC-registered identity',
    limit: '₦200,000 / day',
    allowedDocs: ['NIN'],
  },
  {
    tier: 3,
    title: 'Tier 3',
    subtitle: 'Government photo ID',
    requirement: 'Submit a valid Passport or Driver\'s Licence',
    what: 'Photo ID reviewed by our compliance team — highest limits',
    limit: '₦5,000,000 / day',
    allowedDocs: ['PASSPORT', 'DRIVERS_LICENSE'],
  },
];

function blankToUndefined(value: string) {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function composeName(profile?: Partial<ProfileDetails>, fallback?: string) {
  const displayName = profile?.displayName?.trim();
  if (displayName) return displayName;
  const joined = [profile?.firstName, profile?.lastName].map((v) => v?.trim()).filter(Boolean).join(' ');
  return joined || fallback || 'Paymax user';
}

function formFromProfile(profile?: ProfileDetails): ProfileForm {
  return {
    firstName:   profile?.firstName   ?? '',
    lastName:    profile?.lastName    ?? '',
    displayName: profile?.displayName ?? '',
    phone:       profile?.phone       ?? '',
    whatsapp:    profile?.whatsapp    ?? '',
    dateOfBirth: profile?.dateOfBirth ?? '',
    gender:      profile?.gender      ?? '',
    state:       profile?.state       ?? '',
    lga:         profile?.lga         ?? '',
    city:        profile?.city        ?? '',
    address:     profile?.address     ?? '',
  };
}

function profileCompletion(form: ProfileForm, email?: string): number {
  const fields = [
    form.firstName, form.lastName, form.phone,
    form.dateOfBirth, form.gender,
    form.state, form.city, form.address,
    email,
  ];
  const filled = fields.filter((f) => f && f.trim().length > 0).length;
  return Math.round((filled / fields.length) * 100);
}

const GENDERS = ['Male', 'Female'];

function statusCopy(status?: string) {
  switch (status) {
    case 'verified':
      return 'Verified';
    case 'pending':
      return 'Pending review';
    case 'failed':
      return 'Action required';
    case 'suspended':
      return 'Suspended';
    default:
      return 'Not submitted';
  }
}

function statusStyle(status?: string) {
  switch (status) {
    case 'verified':
      return { bg: 'rgba(22,163,74,0.12)', fg: '#15803D', icon: CheckCircle2 };
    case 'pending':
      return { bg: 'rgba(161,92,0,0.12)', fg: '#A15C00', icon: Clock3 };
    case 'failed':
    case 'suspended':
      return { bg: Colors.errorContainer, fg: Colors.error, icon: AlertCircle };
    default:
      return { bg: Colors.secondaryFixed, fg: Colors.secondary, icon: ShieldCheck };
  }
}

export default function ProfileScreen() {
  const qc = useQueryClient();
  const { user, logout, setUser } = useAuthStore();

  const [profileForm, setProfileForm] = useState<ProfileForm>(EMPTY_PROFILE_FORM);
  const [profileExpanded, setProfileExpanded] = useState(true);
  const [selectedTier, setSelectedTier] = useState<1 | 2 | 3>(1);
  const [documentType, setDocumentType] = useState<KycDocumentType>('BVN');
  const [documentNumber, setDocumentNumber] = useState('');
  const [profileError, setProfileError] = useState('');
  const [kycError, setKycError] = useState('');

  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: getProfile,
  });

  const kycQuery = useQuery({
    queryKey: ['kyc'],
    queryFn: getKyc,
  });

  useEffect(() => {
    if (!profileQuery.data) return;
    // Merge server values into the form instead of replacing it: an empty/omitted
    // field from the server must never clear a detail the user already provided, so
    // previously-entered information stays populated and editable (and the Tier 0
    // checklist keeps seeing e.g. the date of birth that was saved).
    const incoming = formFromProfile(profileQuery.data);
    setProfileForm((current) => {
      const merged = { ...current };
      (Object.keys(incoming) as (keyof ProfileForm)[]).forEach((key) => {
        const value = incoming[key];
        if (value && value.trim()) merged[key] = value;
      });
      return merged;
    });
  }, [profileQuery.data]);

  useEffect(() => {
    const requested = kycQuery.data?.requestedTier;
    const nextTier = requested ?? Math.min(Math.max((kycQuery.data?.kycTier ?? 0) + 1, 1), 3) as 1 | 2 | 3;
    setSelectedTier(nextTier);
  }, [kycQuery.data?.kycTier, kycQuery.data?.requestedTier]);

  const initials = useMemo(() => {
    const name = composeName(profileQuery.data, user?.fullName);
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }, [profileQuery.data, user?.fullName]);

  const currentName = composeName(profileQuery.data, user?.fullName);
  const currentEmail = profileQuery.data?.email ?? user?.email ?? 'No email';
  const currentPhone = profileForm.phone || user?.phone || 'No phone';
  const kyc = kycQuery.data;
  const currentTier = kyc?.kycTier ?? 0;
  const status = statusStyle(kyc?.status);
  const StatusIcon = status.icon;
  const isRefreshing = profileQuery.isRefetching || kycQuery.isRefetching;
  const completion = profileCompletion(profileForm, currentEmail !== 'No email' ? currentEmail : undefined);

  const saveProfile = useMutation({
    mutationFn: () => updateProfile({
      firstName:   blankToUndefined(profileForm.firstName),
      lastName:    blankToUndefined(profileForm.lastName),
      displayName: blankToUndefined(profileForm.displayName),
      phone:       blankToUndefined(profileForm.phone),
      whatsapp:    blankToUndefined(profileForm.whatsapp),
      dateOfBirth: blankToUndefined(profileForm.dateOfBirth),
      gender:      blankToUndefined(profileForm.gender),
      state:       blankToUndefined(profileForm.state),
      lga:         blankToUndefined(profileForm.lga),
      city:        blankToUndefined(profileForm.city),
      address:     blankToUndefined(profileForm.address),
    }),
    onSuccess: (updated) => {
      setProfileError('');
      setProfileExpanded(false);
      qc.setQueryData(['profile'], updated);
      if (user) {
        setUser({
          ...user,
          fullName: composeName(updated, user.fullName),
          phone: updated.phone ?? user.phone,
        });
      }
      alertAsync({ title: 'Profile updated', message: 'Your account information has been saved.' });
    },
    onError: (error) => setProfileError(getErrorMessage(error)),
  });

  const submitKycRequest = useMutation({
    mutationFn: () => submitKyc({
      requestedTier: selectedTier,
      documentType,
      documentNumber: documentNumber.trim(),
      phone: blankToUndefined(profileForm.phone),
    }),
    onSuccess: (updated) => {
      setKycError('');
      setDocumentNumber('');
      qc.setQueryData(['kyc'], updated);
      if (user) setUser({ ...user, kycStatus: updated.status });
      alertAsync({ title: 'KYC submitted', message: `Your Tier ${selectedTier} KYC request is pending review.` });
    },
    onError: (error) => setKycError(getErrorMessage(error)),
  });

  const claimTier0Request = useMutation({
    mutationFn: claimTier0,
    onSuccess: (updated) => {
      setKycError('');
      qc.setQueryData(['kyc'], updated);
      if (user) setUser({ ...user, kycStatus: updated.status });
      alertAsync({ title: 'Tier 0 activated', message: 'Your account is now Tier 0 verified.' });
    },
    onError: (error) => setKycError(getErrorMessage(error)),
  });

  const setProfileValue = (field: keyof ProfileForm, value: string) => {
    setProfileForm((current) => ({ ...current, [field]: value }));
  };

  const handleRefresh = () => {
    void profileQuery.refetch();
    void kycQuery.refetch();
  };

  const handleSaveProfile = () => {
    setProfileError('');
    if (!profileForm.firstName.trim() && !profileForm.displayName.trim()) {
      setProfileError('Enter your first name or display name.');
      return;
    }
    if (profileForm.phone.trim() && !/^(\+234|0)[789][01]\d{8}$/.test(profileForm.phone.trim())) {
      setProfileError('Enter a valid Nigerian phone number.');
      return;
    }
    saveProfile.mutate();
  };

  const handleSubmitKyc = () => {
    setKycError('');
    if (kyc?.status === 'verified' && currentTier >= selectedTier) {
      setKycError(`Your account is already verified at Tier ${currentTier}.`);
      return;
    }
    if (kyc?.status === 'pending') {
      setKycError('A KYC request is already pending review. Please wait for it to be processed.');
      return;
    }
    if (!profileForm.phone.trim()) {
      setKycError('Save your phone number before submitting KYC.');
      return;
    }
    if (!profileForm.dateOfBirth.trim()) {
      setKycError('Save your date of birth before submitting KYC.');
      return;
    }
    if (documentNumber.trim().length < 6) {
      setKycError('Enter a valid document number (minimum 6 characters).');
      return;
    }
    submitKycRequest.mutate();
  };

  const handleLogout = async () => {
    const ok = await confirmAsync({ title: 'Sign Out', message: 'Are you sure you want to sign out?', confirmLabel: 'Sign Out', destructive: true });
    if (!ok) return;
    await logout();
    router.replace('/(auth)/login');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />}
        >
          <LinearGradient colors={['#340075', '#0051D5']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <View style={styles.heroTopRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarInitial}>{initials || 'PU'}</Text>
              </View>
              <Pressable onPress={handleRefresh} style={styles.heroAction} disabled={isRefreshing}>
                {isRefreshing
                  ? <ActivityIndicator color={Colors.onPrimary} size="small" />
                  : <RefreshCw size={18} color={Colors.onPrimary} strokeWidth={2.2} />}
              </Pressable>
            </View>
            <Text style={styles.name}>{currentName}</Text>
            <Text style={styles.email}>{currentEmail}</Text>

            <View style={styles.heroStats}>
              <View style={styles.heroStat}>
                <Text style={styles.heroStatValue}>{currentPhone}</Text>
                <Text style={styles.heroStatLabel}>Phone</Text>
              </View>
              <View style={styles.heroStatDivider} />
              <View style={styles.heroStat}>
                <Text style={styles.heroStatValue}>Tier {currentTier}</Text>
                <Text style={styles.heroStatLabel}>KYC level</Text>
              </View>
              <View style={styles.heroStatDivider} />
              <View style={styles.heroStat}>
                <Text style={styles.heroStatValue}>{completion}%</Text>
                <Text style={styles.heroStatLabel}>Profile</Text>
              </View>
            </View>

            <View style={styles.completionBar}>
              <View style={[styles.completionFill, { width: `${completion}%` as `${number}%` }]} />
            </View>
          </LinearGradient>

          <View style={[styles.statusCard, shadow1]}>
            <View style={[styles.statusIcon, { backgroundColor: status.bg }]}>
              <StatusIcon size={20} color={status.fg} strokeWidth={2.2} />
            </View>
            <View style={styles.statusTextWrap}>
              <Text style={styles.statusTitle}>KYC {statusCopy(kyc?.status)}</Text>
              <Text style={styles.statusSub}>
                {kyc?.status === 'pending' && kyc.requestedTier
                  ? `Tier ${kyc.requestedTier} request is awaiting admin review.`
                  : currentTier > 0
                    ? `Your active account level is Tier ${currentTier}.`
                    : 'Complete KYC to unlock higher wallet limits.'}
              </Text>
            </View>
          </View>

          {(profileQuery.isLoading || kycQuery.isLoading) && !profileQuery.data ? (
            <View style={[styles.card, styles.loadingCard, shadow1]}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={styles.loadingText}>Loading profile</Text>
            </View>
          ) : null}

          <View style={[styles.card, shadow1]}>
            <Pressable style={styles.sectionHeader} onPress={() => setProfileExpanded((v) => !v)}>
              <View style={styles.sectionIcon}>
                <UserRound size={18} color={Colors.primary} strokeWidth={2.2} />
              </View>
              <View style={styles.sectionHeaderText}>
                <Text style={styles.sectionTitle}>User Information</Text>
                <Text style={styles.sectionSub}>Update the details attached to your Paymax account.</Text>
              </View>
              {profileExpanded
                ? <ChevronUp size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
                : <ChevronDown size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />}
            </Pressable>

            {profileExpanded && (
              <>
                <TextInputField label="First name" value={profileForm.firstName} onChangeText={(value) => setProfileValue('firstName', value)} autoCapitalize="words" />
                <TextInputField label="Last name" value={profileForm.lastName} onChangeText={(value) => setProfileValue('lastName', value)} autoCapitalize="words" />
                <TextInputField label="Display name (optional)" value={profileForm.displayName} onChangeText={(value) => setProfileValue('displayName', value)} autoCapitalize="words" />
                <TextInputField label="Phone number" value={profileForm.phone} onChangeText={(value) => setProfileValue('phone', value)} keyboardType="phone-pad" placeholder="08012345678" />
                <TextInputField label="WhatsApp number (optional)" value={profileForm.whatsapp} onChangeText={(value) => setProfileValue('whatsapp', value)} keyboardType="phone-pad" placeholder="08012345678" />

                <DatePickerField
                  label="Date of birth"
                  value={profileForm.dateOfBirth}
                  onChange={(date) => setProfileValue('dateOfBirth', date)}
                />

                <Text style={styles.fieldLabel}>Gender</Text>
                <View style={styles.segmentWrap}>
                  {GENDERS.map((g) => {
                    const active = profileForm.gender === g;
                    return (
                      <Pressable key={g} onPress={() => setProfileValue('gender', g)} style={[styles.segment, active && styles.segmentActive]}>
                        <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{g}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <TextInputField label="Country" value="Nigeria" editable={false} />

                <SelectField
                  label="State"
                  placeholder="Select state"
                  value={profileForm.state}
                  options={STATE_NAMES}
                  onChange={(val) => {
                    setProfileValue('state', val);
                    setProfileValue('lga', '');
                    setProfileValue('city', '');
                  }}
                />
                <SelectField
                  label="LGA"
                  placeholder={profileForm.state ? 'Select LGA' : 'Select state first'}
                  value={profileForm.lga}
                  options={getLGAsForState(profileForm.state)}
                  onChange={(val) => setProfileValue('lga', val)}
                  disabled={!profileForm.state}
                />
                <SelectField
                  label="City"
                  placeholder={profileForm.state ? 'Select city' : 'Select state first'}
                  value={profileForm.city}
                  options={getLGAsForState(profileForm.state)}
                  onChange={(value) => setProfileValue('city', value)}
                  disabled={!profileForm.state}
                />
                <TextInputField label="Residential address" value={profileForm.address} onChangeText={(value) => setProfileValue('address', value)} autoCapitalize="words" />

                {profileError ? <Text style={styles.errorText}>{profileError}</Text> : null}
                <PrimaryButton label="Save Profile" onPress={handleSaveProfile} loading={saveProfile.isPending} disabled={profileQuery.isLoading} />
              </>
            )}
          </View>

          <View style={[styles.card, shadow1]}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon}>
                <ShieldCheck size={18} color={Colors.primary} strokeWidth={2.2} />
              </View>
              <View>
                <Text style={styles.sectionTitle}>KYC Verification</Text>
                <Text style={styles.sectionSub}>Select the wallet tier you want and submit your identity details.</Text>
              </View>
            </View>

            {/* Tier 0 auto-verification block */}
            {(currentTier === 0 && kyc?.status !== 'verified') && (
              <View style={styles.tier0Card}>
                <Text style={styles.tier0Title}>Tier 0 — Quick Activation</Text>
                <Text style={styles.tier0Sub}>Provide your email, date of birth and phone to activate Tier 0 instantly. No documents required.</Text>
                <View style={styles.tier0Checks}>
                  <View style={styles.tier0Row}>
                    {currentEmail && currentEmail !== 'No email'
                      ? <CheckCircle2 size={16} color="#15803D" strokeWidth={2.2} />
                      : <AlertCircle size={16} color={Colors.error} strokeWidth={2.2} />}
                    <Text style={styles.tier0CheckLabel}>Email address</Text>
                  </View>
                  <View style={styles.tier0Row}>
                    {profileForm.phone.trim()
                      ? <CheckCircle2 size={16} color="#15803D" strokeWidth={2.2} />
                      : <AlertCircle size={16} color={Colors.error} strokeWidth={2.2} />}
                    <Text style={styles.tier0CheckLabel}>Phone number</Text>
                  </View>
                  <View style={styles.tier0Row}>
                    {profileForm.dateOfBirth.trim()
                      ? <CheckCircle2 size={16} color="#15803D" strokeWidth={2.2} />
                      : <AlertCircle size={16} color={Colors.error} strokeWidth={2.2} />}
                    <Text style={styles.tier0CheckLabel}>Date of birth</Text>
                  </View>
                </View>
                <PrimaryButton
                  label="Activate Tier 0"
                  onPress={() => {
                    setKycError('');
                    if (!profileForm.phone.trim()) {
                      setKycError('Save your phone number first.');
                      return;
                    }
                    if (!profileForm.dateOfBirth.trim()) {
                      setKycError('Save your date of birth first.');
                      return;
                    }
                    claimTier0Request.mutate();
                  }}
                  loading={claimTier0Request.isPending}
                  disabled={kyc?.status === 'pending' || kycQuery.isLoading}
                />
              </View>
            )}

            <View style={styles.tierList}>
              {TIER_OPTIONS.map((option) => {
                const isCurrent = currentTier === option.tier && kyc?.status === 'verified';
                const isPending = kyc?.status === 'pending' && kyc.requestedTier === option.tier;
                const selectable = option.tier > 0;
                const selected = option.tier === selectedTier;
                return (
                  <Pressable
                    key={option.tier}
                    disabled={!selectable || submitKycRequest.isPending}
                    onPress={() => selectable && setSelectedTier(option.tier as 1 | 2 | 3)}
                    style={[
                      styles.tierCard,
                      selected && selectable && styles.tierCardSelected,
                      !selectable && styles.tierCardMuted,
                    ]}
                  >
                    <View style={styles.tierTopRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.tierTitle}>{option.title}</Text>
                        <Text style={styles.tierSubtitle}>{option.subtitle}</Text>
                      </View>
                      {isCurrent ? <Text style={styles.verifiedPill}>Active</Text> : null}
                      {isPending ? <Text style={styles.pendingPill}>Pending</Text> : null}
                    </View>
                    <Text style={styles.tierRequirement}>{option.requirement}</Text>
                    <Text style={styles.tierWhat}>{option.what}</Text>
                    <Text style={styles.tierLimit}>{option.limit}</Text>
                  </Pressable>
                );
              })}
            </View>

            {(() => {
              const tierDef = TIER_OPTIONS.find((t) => t.tier === selectedTier);
              const allowedDocs = tierDef?.allowedDocs ?? [];
              if (allowedDocs.length === 0) return null;

              const docLabels: Record<KycDocumentType, string> = {
                BVN: 'BVN',
                NIN: 'NIN',
                PASSPORT: 'Passport',
                DRIVERS_LICENSE: 'Driver\'s Licence',
              };

              // Auto-select if only one option
              if (allowedDocs.length === 1 && documentType !== allowedDocs[0]) {
                setDocumentType(allowedDocs[0]);
              }

              return (
                <>
                  {allowedDocs.length > 1 && (
                    <>
                      <Text style={styles.fieldLabel}>Document type</Text>
                      <View style={styles.segmentWrap}>
                        {allowedDocs.map((doc) => {
                          const active = doc === documentType;
                          return (
                            <Pressable
                              key={doc}
                              onPress={() => setDocumentType(doc)}
                              style={[styles.segment, active && styles.segmentActive]}
                            >
                              <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{docLabels[doc]}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  )}
                  <TextInputField
                    label={`${docLabels[documentType] || 'Document'} number`}
                    value={documentNumber}
                    onChangeText={setDocumentNumber}
                    autoCapitalize="characters"
                    placeholder={
                      documentType === 'BVN' ? '11-digit BVN' :
                      documentType === 'NIN' ? '11-digit NIN' :
                      documentType === 'PASSPORT' ? 'Passport number' :
                      'Licence number'
                    }
                  />
                </>
              );
            })()}

            {kycError ? <Text style={styles.errorText}>{kycError}</Text> : null}

            {kyc?.status === 'failed' && (
              <View style={styles.failedBanner}>
                <Text style={styles.failedBannerText}>
                  Your previous KYC submission was declined. Please correct your details and resubmit.
                </Text>
              </View>
            )}

            <PrimaryButton
              label={kyc?.status === 'failed' ? `Resubmit Tier ${selectedTier} KYC` : `Submit Tier ${selectedTier} KYC`}
              onPress={handleSubmitKyc}
              loading={submitKycRequest.isPending}
              disabled={kyc?.status === 'pending' || kycQuery.isLoading || (kyc?.status === 'verified' && currentTier >= selectedTier)}
            />
            {kyc?.status === 'pending' ? (
              <Text style={styles.inlineNote}>
                Tier {kyc.requestedTier} request is pending admin review. You'll be notified once processed.
              </Text>
            ) : null}
          </View>

          <Pressable
            onPress={() => router.push('/(merchant)')}
            style={({ pressed }) => [styles.merchantCard, shadow1, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel="Become a merchant or service provider"
          >
            <View style={styles.merchantIcon}>
              <Store size={20} color={Colors.onPrimary} strokeWidth={2} />
            </View>
            <View style={styles.merchantBody}>
              <Text style={styles.merchantTitle}>Become a Merchant / Provider</Text>
              <Text style={styles.merchantSub}>Sell or offer services — keep your customer account</Text>
            </View>
            <ChevronRight size={18} color={Colors.onPrimary} strokeWidth={2} />
          </Pressable>

          <Pressable
            onPress={() => router.push('/profile/business')}
            style={({ pressed }) => [styles.settingsRow, shadow1, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel="Business and CAC registration"
          >
            <View style={styles.settingsIcon}>
              <Building2 size={20} color={Colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.merchantBody}>
              <Text style={styles.settingsTitle}>Business / Merchant</Text>
              <Text style={styles.settingsSub}>Register or verify your business with CAC</Text>
            </View>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          <Pressable
            onPress={() => router.push('/security/set-pin?mode=manage')}
            style={({ pressed }) => [styles.settingsRow, shadow1, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel="Security and transaction PIN"
          >
            <View style={styles.settingsIcon}>
              <KeyRound size={20} color={Colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.merchantBody}>
              <Text style={styles.settingsTitle}>Security · Transaction PIN</Text>
              <Text style={styles.settingsSub}>Set or change the 4-digit PIN used to authorise payments</Text>
            </View>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          <Pressable
            onPress={() => router.push('/invest-settings')}
            style={({ pressed }) => [styles.settingsRow, shadow1, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel="Investment settings"
          >
            <View style={styles.settingsIcon}>
              <LineChart size={20} color={Colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.merchantBody}>
              <Text style={styles.settingsTitle}>Investment Settings</Text>
              <Text style={styles.settingsSub}>Risk profile, linked banks, fees, statements & security</Text>
            </View>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          <View style={[styles.signOutCard, shadow1]}>
            <Pressable onPress={handleLogout} style={styles.signOutButton}>
              <LogOut size={19} color={Colors.error} strokeWidth={2.2} />
              <Text style={styles.signOutText}>Sign Out</Text>
            </Pressable>
          </View>

          <Text style={styles.version}>Paymax v1.0.0</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  merchantCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.md, marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md, marginBottom: Spacing.sm },
  merchantIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  settingsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.outlineVariant },
  settingsIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  settingsTitle: { ...Typography.labelLg, color: Colors.onSurface },
  settingsSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  merchantBody: { flex: 1, gap: 2 },
  merchantTitle: { ...Typography.labelLg, color: Colors.onPrimary },
  merchantSub: { ...Typography.labelSm, color: Colors.inverseOnSurface },
  content: {
    paddingBottom: Platform.OS === 'ios' ? 116 : 96,
  },
  hero: {
    padding: Spacing.xl,
    paddingTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  avatar: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  avatarInitial: { fontSize: 26, fontWeight: '800', color: Colors.onPrimary },
  heroAction: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  name: { ...Typography.titleLg, color: Colors.onPrimary, marginBottom: 2 },
  email: { ...Typography.labelSm, color: 'rgba(255,255,255,0.78)', marginBottom: Spacing.lg },
  heroStats: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  heroStat: { flex: 1, paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm, alignItems: 'center' },
  heroStatValue: { ...Typography.labelLg, color: Colors.onPrimary, textAlign: 'center' },
  heroStatLabel: { ...Typography.caption, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  heroStatDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.18)' },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
  },
  statusIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTextWrap: { flex: 1 },
  statusTitle: { ...Typography.labelLg, color: Colors.onSurface },
  statusSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.lg,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
  },
  loadingCard: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  loadingText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  sectionHeader: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'flex-start',
    marginBottom: Spacing.lg,
  },
  sectionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  sectionHeaderText: { flex: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  sectionSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  fieldLabel: {
    ...Typography.labelMd,
    color: Colors.onSurface,
    marginBottom: Spacing.xs,
  },
  segmentWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  segment: {
    minHeight: 42,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryFixed,
  },
  segmentLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  segmentLabelActive: { color: Colors.primary, fontWeight: '700' },
  tierList: { gap: Spacing.sm, marginBottom: Spacing.lg },
  tierCard: {
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  tierCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryFixed,
  },
  tierCardMuted: {
    backgroundColor: Colors.surfaceContainerLowest,
  },
  tierTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  tierTitle: { ...Typography.labelLg, color: Colors.onSurface },
  tierSubtitle: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  tierRequirement: { ...Typography.labelSm, color: Colors.onSurface, marginBottom: 2 },
  tierWhat: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: 4 },
  tierLimit: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' },
  verifiedPill: {
    ...Typography.labelSm,
    color: '#15803D',
    backgroundColor: 'rgba(22,163,74,0.12)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  pendingPill: {
    ...Typography.labelSm,
    color: '#A15C00',
    backgroundColor: 'rgba(161,92,0,0.12)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  errorText: {
    ...Typography.bodySm,
    color: Colors.error,
    marginBottom: Spacing.md,
  },
  inlineNote: {
    ...Typography.bodySm,
    color: Colors.onSurfaceVariant,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  signOutCard: {
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.lg,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    overflow: 'hidden',
  },
  signOutButton: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  signOutText: { ...Typography.labelLg, color: Colors.error },
  version: { ...Typography.caption, color: Colors.outline, textAlign: 'center', marginTop: Spacing.xs, paddingBottom: Spacing.sm },
  completionBar: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginTop: Spacing.sm,
    overflow: 'hidden',
  },
  completionFill: {
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 2,
  },
  failedBanner: {
    backgroundColor: Colors.errorContainer,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.error,
  },
  failedBannerText: {
    ...Typography.bodySm,
    color: Colors.error,
    lineHeight: 18,
  },
  tier0Card: {
    backgroundColor: Colors.primaryFixed,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  tier0Title: { ...Typography.labelLg, color: Colors.primary, marginBottom: 4 },
  tier0Sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md, lineHeight: 18 },
  tier0Checks: { gap: Spacing.sm, marginBottom: Spacing.md },
  tier0Row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  tier0CheckLabel: { ...Typography.bodySm, color: Colors.onSurface },
});
